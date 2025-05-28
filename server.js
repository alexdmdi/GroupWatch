// LAYOUT:
// 1) Express serves the static HTML file that includes the client-side JavaScript for Socket.IO (the stuff in public folder in this case)
// 2) When the HTML file is loaded in the browser, the client-side JavaScript connects to the server via WebSocket using Socket.IO
// 3) Socket.IO handles real-time communication, listening for emits events between the server and connected clients
// 4) The server side socket listens for various things
// 4.1) For example: message events from clients, so it can then broadcast the message to all other clients in the given room 
//      (based on a randomly generated unique roomID each time a room is created) for real-time chat
// --------------------------------------------------------------------------------------------------------

//Notes
//---------------------------------------------------------------------------------------------------------
//io.to(roomID).emit() - Sends to everyone in the room including the sender
//socket.to(roomID).emit() sends to everyone in the room except the sender


"use strict";

const express = require('express');    // This imports the Express library
const http = require('http');          // Creates an HTTP server using Express. This is needed because Socket.IO works with HTTP server to enable WebSocket communication
const socketIo = require('socket.io'); // Imports socketIO for handling real-time bidirectional communication between the client and server, like for a live chat in this case
const generateUniqueID = require('generate-unique-id'); // For generating unique room IDs //!(and maybe users?)

const app = express(); // Creates an instance of an Express application
const server = http.createServer(app);
const io = socketIo(server); // Initializes Socket.IO with the HTTP server. The 'io' object is used to handle WebSocket connections



app.use(express.static(__dirname + '/public')); // For serving static files from the 'public' folder. When a request is made to the server it will look for files in this folder and serve them if they exist

// Serves the index.html file on the root route
app.get(`/`, (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
})

// Global Variables, initialized as empty
const rooms = {}; // Room-specific object containing data and more object(s)
const users = {}; //! Global list of all users with expected format of {"socketID" : [username, true/false]}? to keep track of if they are in a room or not


// Helper function used in socket.on('disconnect') and socket.on('user-leaves-room').
// A function like should stay defined outside of io.on('connection',...) to avoid a new copy of the function being 
// created each time a user connects as it does not rely on any variables unique to each connection's closure
    // This function will take care of:
            // - Removing user from rooms[roomUserWasInID].joined_users
            // - Decrementing userCount
            // - Removing from roomLeaders if applicable
            // - Emitting 'update-users-list' and 'user-left' to the room
            // - Leaving the socket.io room
            // - Deleting the room if it becomes empty
            // - Logging details about room changes
    function handleUserLeavingRoom(socket, roomID) {
      if (rooms[roomID] && rooms[roomID].joined_users[socket.id]) {
        const username = rooms[roomID].joined_users[socket.id]; // Get username before deleting
        console.log(`User ${username} (Socket ID: ${socket.id}) is leaving/disconnecting from room ${roomID}`);

        // Remove the user from the room's inner users object
        delete rooms[roomID].joined_users[socket.id];
        // If the user was a leader, remove them from leaders list
        if (rooms[roomID].roomLeaders[socket.id]) {
          delete rooms[roomID].roomLeaders[socket.id];
          //!Implement logic to assign a new leader if there are no other leaders left in that inner obj
          console.log(`User ${username} was a leader in room ${roomID} and has been also removed from leadership.`)
        }

        rooms[roomID].userCount--;

        // Notify other users in the room
        io.to(roomID).emit('message', `${username} has left the room.`);
        io.to(roomID).emit("update-users-list", {usersInRoom_fromServer: rooms[roomID].joined_users});

        // Send username along with socketID for the user-left event
        io.to(roomID).emit("user-left", {socketID: socket.id, roomID, username});

        socket.leave(roomID); // Socket.IO internal cleanup for the room

        // Now, if the room is empty, delete it
        if (rooms[roomID].userCount === 0 ) {
          console.log(`Room ${roomID} is now empty and will be deleted`);
          delete rooms[roomID];
        }
        else {
          console.log(`Updated room ${roomID} state: ${JSON.stringify(rooms[roomID])}`);
        }

        console.table(rooms) // Log current rooms state (server side)
        return true; // success

      }
      else {
        //This case might happen if disconnect fires after the room is already cleaned, or somehow an invalid roomID
        console.log(`User with socket ID ${socket.id} not found in room ${roomID}, or room does not exist for cleanup.`);
        return false; // indicate failure or user not in room
      }

    }; // End of handleUserLeavingRoom helper function

//-----------------------------------------------------------------------------------------------
// Handles all socket connection requests from web clients
io.on('connection', (socket) => {
    
    console.log(`New connection with ID of ${socket.id}`); //logs server side
    io.to(socket.id).emit('on-connection', socket.id); // Send only the socket ID to the client
    
    // Handles a new user setting their username
    socket.on('new-user', (username) => {
      if (username && username.trim() !== "")
      {
        users[socket.id] = username; // Add user to the global users list
        console.log(`User ${username} connected with socket ID: ${socket.id}`);
      // io.emit('set-videoLink', currentVideoLink); // emits to client //! deal with this?
      }
      
      console.log(`There are currently ${Object.keys(users).length} global users: ${JSON.stringify(users)} and ${Object.keys(rooms).length} room(s)`); //logs serverside
    });

    // Handles room creation
    socket.on('create-room', ({username, socketID}) => {
      const roomID = generateUniqueID({length:14});
      
      // Prevents room creation in the rare case of a generated ID collision, and in the case of a user trying to create more than 1 active room at once
      //!implement check if the person is not hosting a room currently, then allow
      if (!rooms.hasOwnProperty(roomID) && username && username.trim()!== "") 
      {
        rooms[roomID] = {
          joined_users: {},
          userCount: 1,
          roomLeaders:  {},
          messages: {},            //!implement messages
          currentVideoLink: "",    //Initially empty
          currentTime: 0,          //Default to 0
          videoPaused: false,      //Default to paused, room creator/leader can start it
          currentPlaybackRate: 1.0 //Default to 1x
        };

        // Add the user to the room's users object
        rooms[roomID].joined_users[socketID] = username;

        // Set the room leader
        rooms[roomID].roomLeaders[socketID] = username;

        // Notify client that the room was created
        socket.emit('created-room', {roomID_fromServer: roomID, roomObj_fromServer: rooms[roomID]}); 

        // Send the updated users list to the room creator
        io.to(socketID).emit('update-users-list', { usersInRoom_fromServer: rooms[roomID].joined_users });

        // Join the socket to the room
        socket.join(roomID);

        // Server side logs
        console.log(`Room has been created by user: ${username} with socket ID: ${socketID}`); 
        console.log(`There are ${Object.keys(rooms).length} rooms on the server`)
        console.table(rooms);
      }
      else 
      {
        console.log('Room create failed')
        socket.emit('room-create-fail');
      }
      
    }); 

    
    // Handles joining a room
    socket.on('join-room', ({ req_socketID, req_roomID, req_username }) => {
      console.log(`Received join request from user: ${req_username}, with socket ID: ${req_socketID}, looking for room: ${req_roomID}`)
      
      // Validate inputs
      if (!req_socketID || !req_roomID || !req_username || !req_username.trim()) 
      {
        console.log(`Invalid join request: ${JSON.stringify({ req_socketID, req_roomID, req_username })}`);
        socket.emit('room-join-fail');
        return;
      }
      
      // Check if room exists
      if (rooms.hasOwnProperty(req_roomID)) 
      {
          console.log(`User ${req_username} is joining room ${req_roomID}`);
          
          //Add user to the respective room objects inner user object
          rooms[req_roomID].joined_users[req_socketID] = req_username; 
          
          // Increment user count
          rooms[req_roomID].userCount++;

          // Join the socket to the room - order matters here, should occur before emitting updates to clients
          socket.join(req_roomID);

          // Notify all clients in the room that a new user has joined
          socket.emit('joined-room', {roomID_fromServer: req_roomID, roomObj_fromServer: rooms[req_roomID]});
          io.to(req_roomID).emit('message', `${req_username} has joined!`)
          
          // Send the updated users list to all users in the room
          console.log(`Emitting updated users list for room ${req_roomID}:`, rooms[req_roomID].joined_users);
          io.to(req_roomID).emit('update-users-list', { usersInRoom_fromServer: rooms[req_roomID].joined_users });
          
          //? Server side logs
          console.log(`Updated room: ${JSON.stringify(rooms[req_roomID])}`);
          console.table(rooms);

      }
      else 
      {
          console.log(`Request to join failed, room with ID ${req_roomID} does not exist`);
          socket.emit('room-join-fail');
      }

    }); 


    // Handles receiving then sending messages
    socket.on('sendMessage', ({message: message, username: username_fromClient, roomID: roomID_fromClient}) => {
      // Checks if the input string is not valid, or if the room does not exist, or if the user is not currently joined in the provided room using their socketID (which is the key/properties in the inner joined_users object)
      // If any of those things are the case, then the request fails resulting in an error message which is logged server-side and sent to the client as well
      if (typeof message !== 'string' || message.trim() === '' || !rooms[roomID_fromClient] || !Object.hasOwn(rooms[roomID_fromClient].joined_users, socket.id)) 
      {
        console.log(`Error: ${username_fromClient} tried to send a message providing a roomID of ${roomID_fromClient} but the roomID is wrong/doesn't exist, or the user not in that room.`);
        socket.emit('error', 'Message could not be sent. Invalid room or user not in room.');
        return;
      } 

      // Broadcast received message to all users in the room and log server side as well. Should only run if the validations above are passed
      console.log(`From room ${roomID_fromClient} - ${username_fromClient}: ${message}`);
      io.to(roomID_fromClient).emit('message', `${username_fromClient}: ${message}`); 
    
    });


    // Handles when user sets the current video playing
    socket.on('videoLink-set', ({roomID : roomID_fromClient, verifiedLink: videoLink_fromClient}) => {
      if (rooms[roomID_fromClient])
      {
        rooms[roomID_fromClient].currentVideoLink = videoLink_fromClient;
        socket.broadcast.to(roomID_fromClient).emit('set-videoLink', rooms[roomID_fromClient].currentVideoLink); //emit video link to all clients except the one who set the link
        console.log(`Current video for room ${roomID_fromClient} set to: ${rooms[roomID_fromClient].currentVideoLink}`);
      }
      else {
        socket.emit('error', `You tried to set the link to ${videoLink_fromClient} with invalid room ID of ${roomID_fromClient}`)
      }

    });


    // Handles when user changes video time
    const rateLimit = {};
    io.use( (socket, next) => {
      socket.on('set-videoTime', ({currentTime: time_fromClient, roomID: roomID_fromClient}) => {
        const now = Date.now();
        if (!rateLimit[socket.id] || now - rateLimit[socket.id] > 1000)
        {
          rateLimit[socket.id] = now;
          rooms[roomID_fromClient].currentTime = time_fromClient;
          console.log(`Current time updated to: ${rooms[roomID_fromClient].currentTime}`);
          socket.to(roomID_fromClient).emit('videoTime-set', rooms[roomID_fromClient].currentTime)
        }
      });
      next();
    });
    

    // Handles when user plays the current video playing
    socket.on('play-video', ({play_message : play_message, roomID : roomID_fromClient}) => {
      console.log(play_message);
      socket.to(roomID_fromClient).emit('video-played', 'Video played');
    });

    // Handles when user pauses the current video playing
    socket.on('pause-video', ({pause_message : pause_message, roomID: roomID_fromClient}) => {
      console.log(pause_message);
      socket.to(roomID_fromClient).emit('video-paused', 'Video paused');
    });

    // Handles when user changes the playback rate. Rate = 0.25 | 0.5 | 1 | 1.5 | 2;
    socket.on('set-playbackRate', ({playbackRate_eventData: playbackRate_fromClient, roomID : roomID_fromClient}) => {
      console.log(`player playback rate set to: ${playbackRate_fromClient}`);
      rooms[roomID_fromClient].currentPlaybackRate = playbackRate_fromClient;
      socket.to(roomID_fromClient).emit('playbackRate-set', rooms[roomID_fromClient].currentPlaybackRate);
    });


    // Handles when a user leaves a room but stays connected
    socket.on('user-leaves-room', ({ roomID }) => {
      if (!rooms[roomID]) {
        console.log(`Attempt to leave non-existent room ${roomID} by socket ${socket.id}`);
          socket.emit('error', 'Cannot leave room: Room does not exist.');
          return;
      }
      if (!rooms[roomID].joined_users[socket.id]) {
            console.log(`User ${socket.id} attempting to leave room ${roomID} but was not in it.`);
            socket.emit('error', 'Cannot leave room: You are not in this room.');
            return;
      }
      
      handleUserLeavingRoom(socket, roomID);
    });


    // Handles user disconnecting fully (closing the tab / loses connection)
    socket.on('disconnect', () => {
      const disconnectedUsername = users[socket.id] || "Unknown user";
      let roomUserWasInID = null; // to store the ID of the room the user was in if any

      // Iterate over a copy of room IDs in case a room is modified by handleUserLeavingRoom,
      // find the room first, then call the handler.
      const currentRoomIDs = Object.keys(rooms);
      for (const roomID of currentRoomIDs) {
          if (rooms[roomID]?.joined_users?.[socket.id]) {
              roomUserWasInID = roomID;
              break; // This works for the logic that a user can only be in one room at a time
          }
      }

      // If the user was in a room, process this by running the helper function
      if (roomUserWasInID) {
        handleUserLeavingRoom(socket, roomUserWasInID);
      }
      
      // Remove the user from the global users list
      if (users[socket.id]){
        delete users[socket.id];
      }

      // Finalizing log messages for the disconnection
      let logMessage = `User ${disconnectedUsername} (Socket ID: ${socket.id}) has fully disconnected`;
      if (roomUserWasInID) {
          logMessage += ` (was in room ${roomUserWasInID})`;
      }
      logMessage += `.`;
      console.log(logMessage);

      console.log(`There are currently ${Object.keys(users).length} global users: ${JSON.stringify(users)}`); //logs serverside

      // Note: If the user wasn't in any room, the 'rooms' object wouldn't have been touched by handleUserLeavingRoom.
      // If they were, handleUserLeavingRoom already called console.table(rooms).
      // So this runs only if no room was affected, as handleUserLeavingRoom would have done it
      if (!roomUserWasInID) { 
        console.table(rooms);
      }

    }); //end of handling disconnect

  
  });

const PORT = process.env.PORT || 3000; // Sets port value to 'PORT" if it is avaialble otherwise defaults to 3000. The server then starts listening for incoming connections on that port.
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
