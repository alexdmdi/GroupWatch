// LAYOUT:
// 1) Express serves the static HTML file that includes the client-side JavaScript for Socket.IO (the stuff in public folder in this case)
// 2) When the HTML file is loaded in the browser, the client-side JavaScript connects to the server via WebSocket using Socket.IO
// 3) Socket.IO handles real-time communication, listening for emits events between the server and connected clients
// 4) The server side socket listens for various things such as messages from clients, and it also broadcasts/emits to clients/rooms (each room has a uniqueID)
// --------------------------------------------------------------------------------------------------------

//Dev Notes
//---------------------------------------------------------------------------------------------------------
//io.to(roomID).emit()     - Sends to everyone in the room including the sender
//socket.to(roomID).emit() - Sends to everyone in the room except the sender
//io.to(roomLeaderSocketID).emit('foobar', {data}) - Sends to the room leader only based on socketID


"use strict";

const express = require('express');    // This imports the Express library
const http = require('http');          // Creates an HTTP server using Express. This is needed because Socket.IO works with HTTP server to enable WebSocket communication
const socketIo = require('socket.io'); // Imports socketIO for handling real-time bidirectional communication between the client and server, like for a live chat in this case
const generateUniqueID = require('generate-unique-id'); // For generating unique room IDs //!(and maybe for users instead of relying on socketID?)

const app = express(); // Creates an instance of an Express application
const server = http.createServer(app);
const io = socketIo(server); // Initializes Socket.IO with the HTTP server. The 'io' object is used to handle WebSocket connections


app.use(express.static(__dirname + '/public')); // For serving static files from the 'public' folder. When a request is made to the server it will look for files in this folder and serve them if they exist

// Serves the index.html file on the root route
app.get(`/`, (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
})

// Global Variables, initialized as empty
//------------------------------------------------------------------------------------
const rooms = {}; // Room-specific global object containing data and more object(s)
const users = {}; // Global list of all users, expected format is {socketID : username} //!Potential format {"socketID" : [username, true/false]} to keep track if a user is in a room or not
const videoTimeUpdateRateLimit = {}; // Global, to be used for ratelimiting. Should be integrated with setvideo-time and perhaps other event handlers?
const MAX_ROOM_SIZE = 20;
//------------------------------------------------------------------------------------


//Helper function that checks if a user is already a member of any room. Used in 'create-room' and 'join-room'
//@param {string} socketID The socket ID of the user to check.
//@returns {string|null} The ID of the room the user is in, or null if they are not in any room.
function getUserRoomID(socketID) 
{
    // Object.keys(rooms) gets an array of all current roomIDs
    for (const roomID of Object.keys(rooms)) 
    {
        // For each room, check if the user's socketID exists as a key in its joined_users object.
        if (rooms[roomID].joined_users[socketID]) 
        {
            // If we find it, we don't need to look further, so return the ID of the room they are in.
            return roomID;
        }
    }
    // If the loop completes without finding the user, they are not in any room.
    return null;
}


// Helper function used in socket.on('disconnect') and socket.on('user-leaves-room').
// A function like this should stay defined outside of io.on('connection',...) to avoid a new copy of the function being 
// created each time a user connects as it does not rely on any variables unique to each connection's closure
    // This function will take care of:
            // - Removing user from rooms[roomID_ToLeave].joined_users
            // - Decrementing userCount
            // - Removing from roomLeader if applicable
            // - Emitting 'update-users-list' and 'user-left' to the room
            // - Leaving the socket.io room
            // - Deleting the room if it becomes empty
            // - Logging details about room changes
function handleUserLeavingRoom(socket, roomID) 
{
      
  // Double check if the room and user (based on ID) exist before doing anything
  if (rooms[roomID] && rooms[roomID].joined_users[socket.id]) 
  {
    // Get username before deleting
    let username = rooms[roomID].joined_users[socket.id]; 
    console.log(`User ${username} (Socket ID: ${socket.id}) is leaving/disconnecting from room ${roomID}`);
        
    // ----------- GENERAL LEAVING LOGIC -------------
        
    // Remove the user from the room's inner users object
    delete rooms[roomID].joined_users[socket.id]; 
    rooms[roomID].userCount--; 

    // Notify remaining users in the room through the chat
    io.to(roomID).emit('message', `${username} has left the room.`);

    // Update the remaining users local 'users-list' object
    io.to(roomID).emit("update-users-list", {usersInRoom_fromServer: rooms[roomID].joined_users});

    // Send username along with socketID for the user-left event
    io.to(roomID).emit("user-left", {socketID: socket.id, roomID, username});

    // Socket.IO - Make the socket officially leave the room
    socket.leave(roomID); 
    // ----------------------------------------------
        

    // -------- LEADER-SPECIFIC LOGIC --------------
    // If the user was the leader, remove them from leaders list
    if (rooms[roomID].roomLeader[socket.id]) 
    {
      delete rooms[roomID].roomLeader[socket.id];
      console.log(`User ${username} was a leader in room ${roomID} and has been also removed from leadership.`)

      // Selecting a new room leader *if* the user who leaves was the leader, and if the room is not empty
      if (rooms[roomID].userCount > 0) 
      {
        const remainingUserIDs = Object.keys(rooms[roomID].joined_users); // Array of IDs from the nested joined_users object
        const newLeaderSocketID = remainingUserIDs[0]; // Select the next person who joined closest in order after the previous leader
        const newLeaderUsername = rooms[roomID].joined_users[newLeaderSocketID];
          
        rooms[roomID].roomLeader = {[newLeaderSocketID] : newLeaderUsername};

        // Server Side Notification
        console.log (`Leadership in room ${roomID} automatically transferred to: ${newLeaderUsername}`)

        // Notify everyone in the room about the new leader
        io.to(roomID).emit('new-leader-assigned', {newLeaderID : newLeaderSocketID, newLeaderUsername : newLeaderUsername});
      }
    }
    // ----------------------------------------------
        
    // ------------ FINAL CLEANUP -------------------
    // If the room is now empty, handle deleting it
    if (rooms[roomID].userCount === 0 ) 
    {
      console.log(`Room ${roomID} is now empty and will be deleted`);
      delete rooms[roomID];
    }
    else 
    {
      console.log(`Updated room ${roomID} state: ${JSON.stringify(rooms[roomID])}`);
    }

    console.table(rooms) // Log current rooms state (server side)
    return true; // success

  }
  else 
  {
    //This case might happen if disconnect fires after the room is already cleaned, or somehow an invalid roomID
    console.log(`User with socket ID ${socket.id} not found in room ${roomID}, or room does not exist for cleanup.`);
    return false; // indicate failure or user not in room
  }

}; // End of handleUserLeavingRoom helper function

//-----------------------------------------------------------------------------------------------
// Handles all socket connection requests from web clients
io.on('connection', (socket) => 
{
  
  console.log(`New connection with ID: ${socket.id}`); //logs server side
  io.to(socket.id).emit('on-connection', socket.id); // Send only the socket ID to the client
  
  // Handles a new user setting their username //! make more robust with uniqueness? or perhaps not needed if unique background ID handles it (currently socket.id's)
  socket.on('new-user', (username) => 
  {
    if (username && username.trim() !== "" && typeof username === "string")
    {
      users[socket.id] = username; // Add user to the global users object { socketID : username }
      socket.emit('username-set', (users[socket.id]));
      console.log(`User ${username} connected with socket ID: ${socket.id}`);
    }
    
    console.log(`There are currently ${Object.keys(users).length} global users: ${JSON.stringify(users)} and ${Object.keys(rooms).length} room(s)`); //logs serverside
  });

  // Handles room creation
  socket.on('create-room', ({username}) => 
  {
    const socketID = socket.id;

    // Verify if the user is already in a room and prevent their request
    const existingRoom = getUserRoomID(socketID);
    if (existingRoom) 
    {
      console.log(`User ${username} with ID ${socketID} tried to create a room but is already in room ${existingRoom}`);
      socket.emit('error', `You are already in room ${existingRoom}. Please leave that room before creating a new one.`);
      return; // stop the create-room block here
    }

    // If no issues so far, setup a unique and random roomID 
    const roomID = generateUniqueID({length:14});
      
    // Prevents room creation in the extremely rare case of a generated ID collision
    if (!rooms.hasOwnProperty(roomID) && username && username.trim()!== "") 
    {
      rooms[roomID] = 
      {
        joined_users: {},
        userCount: 1,
        roomLeader:  {},         //Initializes as empty; should be form {socketID : username} and there should only be 1 room leader at a time, but they may choose to pass the 'remote' to another joined user
        messages: {},            //!implement messages
        currentVideoLink: "",    //Initially empty
        currentTime: 0,          //Default to 0
        videoPaused: false,      //Default to paused, room creator/leader can start it
        currentPlaybackRate: 1.0 //Default to 1x
      };

      // Add the user to the room's users object
      rooms[roomID].joined_users[socketID] = username;

      // Set the room leader (roomLeader object of type socketID String: username: String)
      rooms[roomID].roomLeader = { [socketID]: username };

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
  socket.on('join-room', ({ req_username, req_roomID }) => 
  {
    const req_socketID = socket.id;
    console.log(`Received join request from user: ${req_username}, with socket ID: ${req_socketID}, looking for room: ${req_roomID}`)

    // Validate inputs
    if (!req_socketID || !req_roomID || !req_username) 
    {
      console.log(`Invalid join request: ${JSON.stringify({ req_socketID, req_roomID, req_username })}`);
      socket.emit('room-join-fail');
      return;
    }

    // Verify if the user is already in a room
    const existingRoom = getUserRoomID(req_socketID);
    if (existingRoom)
    {
      console.log(`User ${req_username} tried to join room ${req_roomID} but is already in room ${existingRoom}`);
      socket.emit('error', `You are already in room ${existingRoom}, please leave that room first`);
      return; // Stop the whole function here
    }

    // Enforce room size limit
    if (rooms[req_roomID].userCount >= MAX_ROOM_SIZE)
    {
      socket.emit('error', 'Room is full!');
      socket.emit('room-join-fail');

      console.log(`User ${req_username} failed to join room: ${req_roomID} because the room is full.`);
      return;
    }
      
    // Check if room exists
    if (rooms.hasOwnProperty(req_roomID)) 
    {
      console.log(`User ${req_username} is joining room ${req_roomID}`);
          
      // Add user to the respective room objects inner user object
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

      //! Ask the current room leader for the current video time if available
      //! Then trigger 'videoTime-UpdateRequest' only for the room leader client
       console.log(`Requesting the current playback time from room leader for room ${req_roomID}`);
       io.to(Object.keys(rooms[req_roomID].roomLeader)[0]).emit('videoTime-UpdateRequest'); //! remove these once fixed/redone
          
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


  socket.on('currentVideoTime-fromLeader', ({roomID : roomID_fromLeader, currentTime : currentTime_fromLeader }) => {
    const socketID_fromLeader = socket.id;
    
    // Verify that the incoming socketID really is the current room leader, then set the current time
    if (rooms[roomID_fromLeader] && rooms[roomID_fromLeader].roomLeader[socketID_fromLeader]) 
    {
      rooms[roomID_fromLeader].currentTime = currentTime_fromLeader;
      console.log(`Success - Server side currentTime value updated to ${currentTime_fromLeader} for room: ${roomID_fromLeader} based on the data pulled from the leader`);
       
      // + 1 (seconds) at the end, to make up for the slight typical buffer delay which should improve true real-time synchronization
      setTimeout(() => {
        socket.to(roomID_fromLeader).emit('videoTime-set', rooms[roomID_fromLeader].currentTime + 1);
        socket.to(roomID_fromLeader).emit('message', "*Syncing Room*");
      }, 1000); 
    }
    else 
    {
      console.log(`Issue: currentVideoTime-FromLeader attempt failed, the incoming ID does not correspond to the current room leader (room: ${roomID})`)
    }
      
    });


  // Handles when the room leader wants to give leader status to another user in the room
  socket.on('roomLeader-changeRequest', ({newLeaderID, roomID}) => 
  {
    console.log(`Manual change request triggered for room leader in room ${roomID}`);
    
    // Security checks
    // 1. Does the room exist
    // 2. Is the person making the request (socket.id) the current leader?
    // 3. Does the target user (newLeaderID) actually exist in the room?
    if (rooms[roomID] && rooms[roomID].roomLeader[socket.id] && rooms[roomID].joined_users[newLeaderID])
    {
      // Extra check in the unexpected event (bug) more than one leader is set in the roomLeader object at the time of this request
      if (Object.keys(rooms[roomID].roomLeader).length > 1) 
      {
        console.log("BUG: At the time of this room leader change request, there were multiple leaders in the roomLeader obj", rooms[roomID].roomLeader);
      }
    
      // Continue either way and set the new leader object emit to 'new-leader-assigned' on client side, for the entire room
      const newLeaderUsername = rooms[roomID].joined_users[newLeaderID];
      rooms[roomID].roomLeader = {[newLeaderID] : newLeaderUsername};
      
      io.to(roomID).emit('new-leader-assigned', {newLeaderID, newLeaderUsername});
      io.to(roomID).emit('message', `${newLeaderUsername} is now the leader 👑`);
      
      console.log(`Emitted new leader ID to all clients in room ${roomID}`);
      console.table(rooms);

    }
    else 
    {
        console.log(`Error completing roomLeader-changeRequest: The client attempting to change the room leader isn't currently the leader, or the room does not exist, or the newly appointed leader does not exist.`);
        socket.emit('error', 'Server: Failed to assign new leader. Either you are the not the leader, or the chosen person is not valid, or the room does not exist.');
    }
    

  });


  // Handles receiving then sending messages
  socket.on('sendMessage', ({message: message, username: username_fromClient, roomID: roomID_fromClient}) => 
  {
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


  // Handles when user sets the current video playing with verifications for the room ID and room leader status (currently based on socketID)
  socket.on('videoLink-set', ({roomID : roomID_fromClient, verifiedLink: videoLink_fromClient}) => 
  {
    if (rooms[roomID_fromClient] && rooms[roomID_fromClient].roomLeader && rooms[roomID_fromClient].roomLeader[socket.id])
    {
      rooms[roomID_fromClient].currentVideoLink = videoLink_fromClient;
      rooms[roomID_fromClient].currentTime = 0; // Reset time when a new video is set
      socket.broadcast.to(roomID_fromClient).emit('set-videoLink', rooms[roomID_fromClient].currentVideoLink); // emit video link to all clients except the one who set the link
      console.log(`Current video for room ${roomID_fromClient} set to: ${rooms[roomID_fromClient].currentVideoLink}`);
    }
    else 
    {
      // User is NOT a leader, or room doesn't exist, or roomLeader object is missing
      socket.emit('error', `Issue: You tried to set the link to ${videoLink_fromClient} but either you are not a room leader or there is an issue with the server data`)
      console.log(`Unauthorized videoLink-set attempt by ${users[socket.id] || socket.id} for room ${roomID_fromClient}`);
    }

  });


  // Handles when user changes video time. Implements rate limiting involving the global 'videoTimeUpdateRateLimit' object, with verifications for the room ID and room leader status (currently based on socketID)
  socket.on('set-videoTime', ({currentTime: time_fromClient, roomID: roomID_fromClient}) => 
  {
    if (rooms[roomID_fromClient] && rooms[roomID_fromClient].roomLeader[socket.id])
    {
      const now = Date.now();
      const socketRateLimit = videoTimeUpdateRateLimit[socket.id] // Use the global rateLimit object

      // 0.25 second rate limit to prevent too much spam (adjust if needed)
      if (!socketRateLimit || now - socketRateLimit > 250) 
      { 
        videoTimeUpdateRateLimit[socket.id] = now;
        rooms[roomID_fromClient].currentTime = time_fromClient;
          
        console.log(`Room ${roomID_fromClient}: Video time updated to: ${rooms[roomID_fromClient].currentTime} by ${users[socket.id]}`);
        socket.to(roomID_fromClient).emit('videoTime-set', rooms[roomID_fromClient].currentTime + 1); // + 1 (seconds) at the end, to make up for the expected slight delay in real world use, improving synchronization
      }
      else 
      {
          // Optional: log rate limit hit, but can be noisy
          // console.log(`Rate limit hit for set-videoTime by ${socket.id} in room ${roomID_fromClient}`);
      }
    }
      
    else 
    {
      socket.emit('error', 'You are not a leader or the room is invalid. Cannot set video time.');
      console.log(`Failed set-videoTime attempt by ${socket.id} for room ${roomID_fromClient}.`);
    }
  });
    

  // Handles when user plays the current video playing, with verifications for the room ID and room leader status (currently based on socketID)
  socket.on('play-video', ({play_message : play_message, roomID : roomID_fromClient}) => 
  {
    if (rooms[roomID_fromClient] && rooms[roomID_fromClient].roomLeader && rooms[roomID_fromClient].roomLeader[socket.id])
    {
      rooms[roomID_fromClient].videoPaused = false;
      socket.to(roomID_fromClient).emit('video-played', 'Video played by room leader');
      console.log(play_message);

    }
    else 
    {
      socket.emit('error', 'You are not a leader or the room is invalid. Cannot set play-video command for the room.');
      console.log(`Failed play-video attempt by ${socket.id} for room ${roomID_fromClient}.`);
    }

  });

  // Handles when user pauses the current video playing, with verifications for the room ID and room leader status (currently based on socketID)
  socket.on('pause-video', ({pause_message : pause_message, roomID: roomID_fromClient}) => 
  {
    if (rooms[roomID_fromClient] && rooms[roomID_fromClient].roomLeader && rooms[roomID_fromClient].roomLeader[socket.id])
    {
      rooms[roomID_fromClient].videoPaused = true;
      socket.to(roomID_fromClient).emit('video-paused', 'Video paused by room leader');
      console.log(pause_message);
        
    }
      
    else 
    {
      socket.emit('error', 'You are not the leader or the room is invalid. Cannot pause video.');
      console.log(`Failed pause-video attempt by ${socket.id} for room ${roomID_fromClient}.`);
    }
      
  });

  // Handles when user changes the playback rate. Rate = 0.25 | 0.5 | 1 | 1.5 | 2, with verifications for the room ID and room leader status (currently based on socketID)
  socket.on('set-playbackRate', ({playbackRate_eventData: playbackRate_fromClient, roomID : roomID_fromClient}) => 
  {
    const allowedRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    if (rooms[roomID_fromClient] && rooms[roomID_fromClient].roomLeader && rooms[roomID_fromClient].roomLeader[socket.id] && allowedRates.includes(playbackRate_fromClient))
    {
      rooms[roomID_fromClient].currentPlaybackRate = playbackRate_fromClient; 
      socket.to(roomID_fromClient).emit('playbackRate-set', rooms[roomID_fromClient].currentPlaybackRate);
        
      console.log(`player playback rate set to: ${playbackRate_fromClient}`);

    }
    else 
    {
      socket.emit('error', 'You are not the leader or the room is invalid. Cannot set playback rate for the room.');
      console.log(`Failed set-playbackRate attempt by ${socket.id} for room ${roomID_fromClient}.`);
    }
      
  });


  // Handles when a user leaves a room but stays connected
  socket.on('user-leaves-room', ({ roomID }) => 
  {
    if (!rooms[roomID]) {
      console.log(`Attempt to leave non-existent room ${roomID} by socket ${socket.id}`);
        socket.emit('error', 'Cannot leave room: Room does not exist.');
        return;
    }
    if (!rooms[roomID].joined_users[socket.id]) 
    {
        console.log(`User ${socket.id} attempting to leave room ${roomID} but was not in it.`);
        socket.emit('error', 'Cannot leave room: You are not in this room.');
        return;
    }
      
    handleUserLeavingRoom(socket, roomID);
  });


  // Handles user disconnecting fully (closing the tab / loses connection)
  socket.on('disconnect', () => 
  {
    const disconnectedUsername = users[socket.id] || "Unknown user";
    let roomID_ToLeave = null; // to store the ID of the room the user was in if any

    // Iterate over a copy of room IDs in case a room is modified by handleUserLeavingRoom,
    // find the room first, then call the handler.
    const currentRoomIDs = Object.keys(rooms);
    for (const roomID of currentRoomIDs) 
    {
      if (rooms[roomID]?.joined_users?.[socket.id]) 
      {
          roomID_ToLeave = roomID;
          break; // This works for the logic that a user can only be in one room at a time
      }
    }

    // If the user was in a room, process this by running the helper function
    if (roomID_ToLeave) 
    {
      handleUserLeavingRoom(socket, roomID_ToLeave);
    }
      
    // Remove the user from the global users list
    if (users[socket.id])
    {
      delete users[socket.id];
    }

    // Finalizing log messages for the disconnection
    let logMessage = `User ${disconnectedUsername} (Socket ID: ${socket.id}) has fully disconnected`;
    if (roomID_ToLeave) 
    {
       logMessage += ` (was in room ${roomID_ToLeave})`;
    }
    logMessage += `.`;
    console.log(logMessage);

    console.log(`There are currently ${Object.keys(users).length} global users: ${JSON.stringify(users)}`); //logs serverside

    // Note: If the user wasn't in any room, the 'rooms' object wouldn't have been touched by handleUserLeavingRoom.
    // If they were, handleUserLeavingRoom already called console.table(rooms).
    // So this runs only if no room was affected, as handleUserLeavingRoom would have done it
    if (!roomID_ToLeave) 
    { 
      console.table(rooms);
    }

  }); //end of handling disconnect

  
});

//! Only for dev environment
const PORT = process.env.PORT || 3000; // Sets port value to 'PORT" if it is avaialble otherwise defaults to 3000. The server then starts listening for incoming connections on that port.
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
