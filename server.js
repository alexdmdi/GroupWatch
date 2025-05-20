// LAYOUT:
// 1) Express serves the static HTML file that includes the client-side JavaScript for Socket.IO (the stuff in public folder in this case)
// 2) When the HTML file is loaded in the browser, the client-side JavaScript connects to the server via WebSocket using Socket.IO
// 3) Socket.IO handles real-time communication, listening for emits events between the server and connected clients
// 4) The server listens for 'sendMessage' events from the clients, and when a message is received, it broadcasts the message to all clients to make the real-time chat function as expected
// -----------------------------------------------------------------------------------------------------------------------

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
const users = {}; // Global list of all users (For debugging and maybe more)
//const roomLeaders = {};      

let currentVideoLink = "https://www.youtube.com/embed/CjpEZ2LAazM?autoplay=1&enablejsapi=1";  //string
let currentTime = "" ;      //integer representing seconds elapsed 
let currentPlaybackRate = "";

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
      // io.emit('username-set', users); //emits global user list to client 

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
          messages: {},
          currentVideoLink: "",
          currentTime: 0,
          videoPaused: false,
          currentPlaybackRate: 1.0
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


    //! leave-room 
    socket.on('leave-room', ({ roomID, socketID }) => {
      // Check if the room exists
      if (rooms[roomID]) 
      {
          console.log(`User with socket ID ${socketID} is leaving room ${roomID}`);
  
          // Remove the user from the room's users object
          delete rooms[roomID].joined_users[socketID];
          rooms[roomID].userCount--;
  
          // If the room is empty, delete it
          if (rooms[roomID].userCount === 0) {
              console.log(`Room ${roomID} is now empty and will be deleted`);
              delete rooms[roomID];
          } else {
              console.log(`Updated room: ${JSON.stringify(rooms[roomID])}`);
              // Ensure the `users` object is valid before emitting
              if (rooms[roomID].joined_users && typeof rooms[roomID].joined_users === "object") {
                io.to(roomID).emit('update-users-list', { usersInRoom_fromServer: rooms[roomID].joined_users });
              }
              io.to(roomID).emit('user-left', { socketID, roomID });
          }
  
          // Notify other users in the room
          socket.to(roomID).emit('user-left', [socketID, roomID, rooms[roomID].joined_users[socket.id]]);

          console.table(rooms); // console log server side
      } 
      
      else 
      {
          console.log(`Room with ID ${roomID} does not exist`);
      }
    });

    // Handles receiving then sending messages
    socket.on('sendMessage', ({message: message, username: username_fromClient, roomID: roomID_fromClient}) => {
      // Checks if the input string is not valid, or if the room does exists, or if the user is currently joined in that room using socketID (which is the key/properties in the joined_users inner object)
      // If any of those things are the case then the request fails and an error message is logged in server and sent to the client as well
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
          currentTime = time_fromClient;
          console.log(`Current time updated to: ${currentTime}`);
          socket.to(roomID_fromClient).emit('videoTime-set', currentTime)
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
      currentPlaybackRate = playbackRate_fromClient;
      socket.to(roomID_fromClient).emit('playbackRate-set', currentPlaybackRate);
    });

    // Handles when a user leaves a room but stays connected
    socket.on('user-leaves-room', ({ roomID, socketID }) => {
      if (rooms[roomID]) 
      {
          console.log(`User with socket ID ${socketID} is leaving room ${roomID}`);

          // Remove the user from the room's users object
          delete rooms[roomID].joined_users[socketID];
          rooms[roomID].userCount--;

          // If the room is empty, delete it
          if (rooms[roomID].userCount === 0) 
          {
              console.log(`Room ${roomID} is now empty and will be deleted`);
              delete rooms[roomID];
          } 
          else 
          {
              console.log(`Updated room: ${JSON.stringify(rooms[roomID])}`);
              console.table(rooms);
              // Notify remaining users in the room
              io.to(roomID).emit('update-users-list', { usersInRoom_fromServer: rooms[roomID].joined_users });
              io.to(roomID).emit('user-left', { socketID, roomID });
          }
      } 
      else 
      {
          console.log(`Room with ID ${roomID} does not exist`);
      }
    });

    // Helper function for when rooms should be deleted
    function cleanUpRoom(roomID) {
      if (rooms[roomID] && rooms[roomID].userCount === 0)
      {
        console.log(`Room ${roomID} is now wempty and will be deleted.`);
        delete rooms[roomID];
      }
    }

    // Handles user disconnecting fully (closing the tab / loses connection)
    socket.on('disconnect', () => {
      for (const roomID in rooms) {
          if (rooms[roomID].joined_users[socket.id]) 
          {
              console.log(`User ${rooms[roomID].joined_users[socket.id]} disconnected from room ${roomID}`);
  
              // Remove the user from the room's joined_users object
              delete rooms[roomID].joined_users[socket.id];
              rooms[roomID].userCount--;
              
              // Notify remaining users in the room about the updated user list
              io.to(roomID).emit('update-users-list', { usersInRoom_fromServer: rooms[roomID].joined_users });
              
              // Delete the room if it's now empty. This potential deletion should be kept as the last step here to not impact previous steps.
              cleanUpRoom(roomID);
          }
      }
      
      // Remove the user from the global users list
      delete users[socket.id];
      console.log(`User with socket ID ${socket.id} has fully disconnected`);
      console.log(`There are currently ${Object.keys(users).length} global users: ${JSON.stringify(users)}`); //logs serverside
    });
  
  });

const PORT = process.env.PORT || 3000; // Sets port value to 'PORT" if it is avaialble otherwise defaults to 3000. The server then starts listening for incoming connections on that port.
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});



//Notes
//----------------------------------------------------------
//io.to(roomID).emit() - Sends to everyone in the room including the sender
//socket.to(roomID).emit() sends to everyone in the room except the sender