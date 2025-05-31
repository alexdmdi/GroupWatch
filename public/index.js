"use strict";

// import {io} from 'socket.io-client';
const socket = io('http://localhost:3000'); //!Initialize socket.io client

//!client side debug functions--------------------------

    function printStatus() {
        console.log(`Username: ${username}`);
        console.log(`Is room leader: ${isRoomLeader}`);
        console.log(`SocketID: ${socketID}`);
        console.log(`roomID: ${roomID}`);
        console.log(`Current video ${localRoomObj.currentVideoLink? localRoomObj.currentVideoLink : "No Video Selected" }`);
        console.log(`Current View state: ${currentAppState}`);
        
    }
//!-----------------------------------------------------


//? Global variables (User side)

let currentAppState = 'STATE_LOADING'; // Start with a loading state perhaps

let username = "";
let socketID = "";
let isRoomLeader = false; 
let localRoomObj = ""; //room Obj containing inner users object, user count (int), roomLeaders object, messages object, current video link, currentTime, currentPlaybackRate
let usersObj = {}  
let roomID;


//?------------YT API MUST BE IN GLOBAL SCOPE AS IS DONE HERE, NOT WITHIN `DOMContentLoaded`---------//
// 1. Load the YouTube IFrame Player API code asynchronously
let tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
let firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
console.log(`tag is: ${tag}`);

let player;

// 2. This will call initializePlayer() when the iFrame is ready
function onYouTubeIframeAPIReady() {
    console.log('YouTube API ready'); // Debugging statement
    
    try {
        setTimeout(initializePlayer, 500);
    }
    catch (error){
        console.log(`initializePlayer error: ${error}`);
    }
}

// 2. This function creates a player object for the existing iframe
//For the player variable to be initialzed, or re-initialized when the selected video changes
function initializePlayer() {
    //Destroys existing player if it exists
    if (player)
    {
        player.destroy();  
        console.log('player object has been destroyed');
    }
    //Grabs iframe element based on id 'yt-iframe', as is set in index.html
    player = new YT.Player('yt-iframe', {
        events: {
            'onReady': onPlayerReady, 
            'onStateChange': onPlayerStateChange, 
            'onPlaybackRateChange': onPlayerPlaybackRateChange, 
            'onError': onPlayerError,
        }
    }); 
    console.log(`initializePlayer() has ran. Player object has a value of: ${JSON.stringify(player)}`);
    
}

function onPlayerReady(event) {
    console.log('onPlayerReady called');
    
    const iframe = document.getElementById('yt-iframe');
    iframe.style.borderColor = '#FF6D00';
    iframe.style.borderWidth = '2px';
    event.target.playVideo();
    console.log('Player is ready'); // Can now use player.seekTo() and other methods
}

 //-1: unstarted, 0: ended, 1: playing, 2: paused, 3: buffering, 4: video cued
function onPlayerStateChange(event) {                       
    console.log('Player state changed to:', event.data);
    console.log(`Current time: ${Math.floor(player.getCurrentTime())}`);
    
    if (event.data === 1 && isRoomLeader) 
    {
        let currentTime = Math.floor(player.getCurrentTime());
        socket.emit('set-videoTime', {currentTime, roomID});  
        socket.emit('play-video', {play_message:'Video played', roomID});
    }
    if (event.data === 2 && isRoomLeader)
    {
        console.log('video paused by you');
        socket.emit('pause-video', {play_message: 'Video paused', roomID});
    }
    
}

// Emits to to server when user changes the playback rate. Rate = 0.25 | 0.5 | 1 | 1.5 | 2;
function onPlayerPlaybackRateChange(event) {
    if (isRoomLeader) 
    {
        console.log('Playback rate changed to:', event.data);  
        socket.emit('set-playbackRate', {playbackRate_eventData: event.data, roomID});
    }
}

//2: The req contains an invalid parameter value. 
//5: The request cannot be played in an HTML player or another related error. 
//100: The requested vidoe was not found.
//101: The owner of the requested video does not allow embedding
//150: Same as 101, it's just error 101 in disguise 
function onPlayerError(event) {                             
    console.log('Error occurred:', event.data);
    window.alert('Error');
}
// ?End of YT api setup (global scope)
//--------------------------------------------------------------------------------------------------------------------//



//?--------------------------------------------------------------------------------------------------------------------//
document.addEventListener('DOMContentLoaded', () => {
    // initial call to set up UI
    updateAppView(); // This will render the initial state (e.g., loading or username prompt)
    

    //?State based rendering functions
    //--------------------------------------------------------------------------------------------------------------------//

    function updateAppView() {
        const appContainer = document.getElementById('app-container');
        if (!appContainer) {
            console.error("App container not found!");
            return;
        }
        // The state functions themselves will set appContainer.innerHTML

        console.log("Updating app view to state:", currentAppState);

        switch (currentAppState) {
            case 'STATE_LOADING':
                renderLoadingView();
                break;
            case 'STATE_SET_USERNAME':
                renderSetUsernameView();
                break;
            case 'STATE_ROOM_SELECTION':
                renderRoomSelectionView();
                break;
            case 'STATE_IN_ROOM':
                renderInRoomView();
                break;
            default:
                console.error('Unknown app state:', currentAppState);
                appContainer.innerHTML = '<p style="color:red;">Error: Application in unknown state.</p>';
        }
    }

    function renderLoadingView() {
        const appContainer = document.getElementById('app-container');
        appContainer.innerHTML = '<p style="color:white;">Loading...</p>';
    }

    function renderSetUsernameView() {
        const appContainer = document.getElementById('app-container');
        appContainer.innerHTML = `
            <main class="center-col">
                <p id="client-status-message" style="color:white"></p>
                <form id="username-form">
                    <input type="text" id="username-input" placeholder="Enter a username" autocomplete="on">
                    <button type="submit">Set Username</button>
                </form>
            </main>
        `;
        document.getElementById('username-form').addEventListener('submit', handleUsernameSubmit);
    }

    function renderRoomSelectionView() {
        const appContainer = document.getElementById('app-container');
        appContainer.innerHTML = `
            <main class="center-col">
                <p style="color:white;">Welcome, ${username}!</p>
                <p id="client-status-message" style="color:white;"></p>
                <form id="roomCreate-form" style="margin-bottom: 10px;">
                    <button type="submit">Create a Private Room</button>
                </form>
                <form id="roomJoin-form">
                    <input type="text" id="roomJoin-input" placeholder="Enter Room ID to Join" autocomplete="off">
                    <button type="submit">Join Room</button>
                </form>
            </main>
        `;
        document.getElementById('roomCreate-form').addEventListener('submit', handleCreateRoom);
        document.getElementById('roomJoin-form').addEventListener('submit', handleJoinRoom);
    }

    function renderInRoomView() {
        const appContainer = document.getElementById('app-container');
        // Determine if video link input should be enabled
        const videoLinkDisabled = !isRoomLeader ? 'disabled' : '';
        const videoLinkPlaceholder = !isRoomLeader ? 'Only room leader can change video' : 'Enter YouTube Video URL';

        appContainer.innerHTML = `
            <div class="left-col">
                <h3>Users in Room:</h3>
                <div id="user-list" style="max-height: 300px; overflow-y: auto;">
                    <!-- User list will be populated by renderUsersList -->
                </div>

                <p id="room-invite-link" style="visibility: visible"> RoomID: ${roomID} </p>
            </div>

            <main class="center-col">
            
                <form id="videolink-form">
                    <input type="text" id="videolink-input" placeholder="${videoLinkPlaceholder}" autocomplete="off" ${videoLinkDisabled}>
                    <button type="submit" id="submit-videolink" ${videoLinkDisabled}>Set Video</button>
                </form>
                <p id="client-status-message" style="color:white;"></p>
                <div id="video-wrapper">
                    <!-- Video iframe will be inserted here by setVideo() -->
                    ${!localRoomObj || !localRoomObj.currentVideoLink ? '<div id="video-placeholder" style="width:640px; height:360px; background:#222; color:white; display:flex; align-items:center; justify-content:center; border: 1px solid #444;">No video loaded. Leader can set one.</div>' : ''}
                </div>

            </main>

            <aside id="right-col">
                <h3>Chat</h3>
                <div id="message-container" style="height: 300px; overflow-y: scroll; border: 1px solid #ccc; padding: 5px; margin-bottom: 10px;">
                    <!-- Messages will appear here -->
                </div>
                <form id="send-container">
                    <input type="text" id="message-input" placeholder="Type a message..." autocomplete="off">
                    <button type="submit" id="send-button">Send</button>
                </form>
                <button id="leaveRoom-button" style="margin-top: 10px;">Leave Room</button>
            </aside>
        `;

        // Attach event listeners for this view
        document.getElementById('videolink-form').addEventListener('submit', handleVideoLinkSubmit);
        document.getElementById('send-container').addEventListener('submit', handleSendMessage);
        document.getElementById('leaveRoom-button').addEventListener('click', handleLeaveRoom);
        document.getElementById('room-invite-link');

        // Populate the dynamic parts
        renderUsersList(); // Assumes usersObj is up to date

        if (localRoomObj && localRoomObj.currentVideoLink) {
            setVideo(localRoomObj.currentVideoLink); // This will create iframe and call initializePlayer
        }
        // Player state (seek, pause, etc.) will be handled by socket events or onPlayerReady
    }
    //? --- End of Application State Management & View Functions ---


    
    
    //?------------------ DOM Event Handler Functions --------------------------------------------------------------//
    function handleUsernameSubmit(event) {
        event.preventDefault();
        const usernameInput = document.getElementById('username-input');

        if (usernameInput && usernameInput.value.trim()) 
        {          
            const proposedUsername = usernameInput.value.trim();
            // Basic sanitization: allow letters, numbers, spaces, underscores, hyphens. Max length.
            if (proposedUsername.length > 20 || !/^[a-zA-Z0-9_ -]+$/.test(proposedUsername)) {
                alert("Username can only contain letters, numbers, spaces, underscores, hyphens and be max 20 chars.");
                return;
            }
            username = proposedUsername;
            socket.emit('new-user', username);
            // Server will respond with 'username-set', which triggers state change
        }
        else 
        {
            alert("Username cannot be empty!");
        }

    };


    function handleCreateRoom(event) {
        event.preventDefault();

        const statusMsg = document.getElementById('client-status-message');
        if (statusMsg) statusMsg.innerText = "Creating room...";
        socket.emit('create-room', { username, socketID });
    }


    function handleJoinRoom(event) {
        event.preventDefault();
        const roomJoinInput = document.getElementById('roomJoin-input');
        const statusMsg = document.getElementById('client-status-message');

        if (roomJoinInput && roomJoinInput.value.trim()) {
            if (statusMsg) statusMsg.innerText = "Joining room...";
            const req_roomID = roomJoinInput.value.trim();
            socket.emit('join-room', { req_username: username, req_socketID: socketID, req_roomID });
        } else {
            alert("Room ID cannot be empty!");
        }
    }
    

    function handleVideoLinkSubmit(event) 
    {
        event.preventDefault();
        const videoLinkInput = document.getElementById('videolink-input');
        if (videoLinkInput && videoLinkInput.value.trim() && isRoomLeader) 
        {
            const rawLink = videoLinkInput.value.trim();
            const verifiedLink = verifyLink(rawLink); // verifyLink is your existing function
            if (verifiedLink) 
            {
                setVideo(verifiedLink); // Client sets its own video immediately
                socket.emit('videoLink-set', { roomID, verifiedLink });
                videoLinkInput.value = ''; // Clear input after successful submission
            } 
            else 
            {
                alert("Invalid YouTube link format!");
            }
        } 
        else if (!isRoomLeader) 
        {
            alert("Only the room leader can set the video.");
        }
    }

    //Sending messages to everyone else in a room, if connected to one 
    function handleSendMessage(event) 
    {
        event.preventDefault();
        const messageInput = document.getElementById('message-input');

        //("if connected" condition enforced by local verification paired with backup server verification)
        if (messageInput && messageInput.value.trim() && roomID && localRoomObj) 
        {
            const message = messageInput.value.trim();
            socket.emit('sendMessage', { message, username, roomID }); // Send an obj containing the message, and roomID to the server
            messageInput.value = '';
        }
    }


    function handleLeaveRoom() 
    {
        if (localRoomObj && roomID) 
        {
            console.log(`Leaving room: ${roomID}`);
            socket.emit('user-leaves-room', { roomID }); // Server knows socket.id

            if (player && typeof player.destroy === 'function') {
                player.destroy();
                player = null;
                console.log("Player destroyed on leaving room.");
            }

            // Reset local state
            localRoomObj = null;
            roomID = null;
            isRoomLeader = false;
            usersObj = {};

            currentAppState = 'STATE_ROOM_SELECTION';
            updateAppView();
        } 
        else 
        {
            console.log("Not in a room, cannot leave.");
        }
    }
    

    //? ------ Utility Functions (renderUsersList, setVideo, verifyLink) ----------------------------------------//
    function renderUsersList() 
    {
        const userListDiv = document.getElementById('user-list');
        if (!userListDiv)
        {
            console.warn("User list container not found in current view.");
            return;
        }
        
        // Ensure users is a valid object
        if (!usersObj || typeof usersObj !== "object") 
        {
            console.log("Users list is not available or invalid.");
            userListDiv.innerHTML = '<li>No user data.</li>';
            return;
        }

        //renders the new list of users
        userListDiv.innerHTML = ''; // Clear current list
        const socketIDs = Object.keys(usersObj);
        if (socketIDs.length === 0) 
        {
            userListDiv.innerHTML = '<li>No users in room.</li>';
            return;
        }
        for (const id of socketIDs) 
        {
            if (usersObj[id]) 
            {
                const userElement = document.createElement('div');
                userElement.innerText = usersObj[id] + (localRoomObj && localRoomObj.roomLeaders && localRoomObj.roomLeaders[id] ? ' (Leader)' : '');
                userElement.id = `user-${id}`; // Ensure unique ID for potential styling/manipulation
                userListDiv.appendChild(userElement);
            }
        }
        
    }


    function verifyLink(link) {
        let videoId = null;

        // Regex to capture video ID from various YouTube URL formats
        const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        // Explanation:
        // (?:https?:\/\/)? : Optional http or https, (?:www\.)? : Optional www., youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/) : Matches youtube.com followed by common paths, |youtu\.be\/ : OR matches youtu.be/, ([a-zA-Z0-9_-]{11}) : Captures the 11-character video ID

        const match = link.match(youtubeRegex);

        if (match && match[1]) {
            videoId = match[1];
        } 
        else {
            console.log('Link did not match any known YouTube regex or no video ID found');
            return false;
        }

        // Base embed URL
        const baseEmbedUrl = `https://www.youtube.com/embed/${videoId}`;

        try {
            // Create a URL object. If the link doesn't have a protocol, prepend https.
            // This is a bit simplified; a full URL parser might be needed for edge cases of partial URLs.
            const fullLinkForParsing = (link.startsWith('http://') || link.startsWith('https://')) ? link : `https://${link}`;
            const url = new URL(fullLinkForParsing); // Use the original link to preserve existing params
            const params = new URLSearchParams(url.search);

            // Set desired parameters (will overwrite if they exist, or add if they don't)
            params.set('autoplay', '1');
            params.set('enablejsapi', '1');

            return `${baseEmbedUrl}?${params.toString()}`;

        } catch (e) {
            // Fallback if the original link was too malformed for the URL constructor,
            // but we have the videoId.
            console.warn('Original link was not a valid URL for param parsing, constructing fresh embed URL:', e.message);
            return `${baseEmbedUrl}?autoplay=1&enablejsapi=1`;
        }
    }   


    function setVideo(link) //verifyLink should run before this happens
    { 
        const videoWrapper = document.getElementById('video-wrapper');
        if (!videoWrapper) {
            console.error("Video wrapper not found");
            return;
        }
        if (username && roomID) // Checks if user is in a room context
        {
            console.log(`The link was set to: ${link}`)
            videoWrapper.innerHTML = `<iframe id="yt-iframe" width="640" height="360" src="${link}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`
            
            if (player && typeof player.destroy === 'function') 
            {
                player.destroy();
                player = null; // Important to nullify
                console.log("Existing player destroyed before setting new video.");
            }
            // YT API might need a moment for the new iframe to be fully in DOM
            setTimeout(initializePlayer, 300); // initializePlayer will create new YT.Player
        } 
        else 
        {
            console.warn("Cannot set video: user not in a room or username not set.");
        }    
    
    }


    //? Socket Event Functions
    //--------------------------------------------------------------------------------------
    socket.on('on-connection', (socketID_fromServer) => { 
        console.log(`You have ID: ${socketID_fromServer} and have succesfully connected! Your username is not set yet`);
        socketID = socketID_fromServer; // Update the local socketID variable 
        
        currentAppState = 'STATE_SET_USERNAME';
        updateAppView(); 
    });

    
    socket.on('username-set', (username) => {
        console.log(`Server confirmation: Username succesfully set as ${username}`);
        currentAppState = 'STATE_ROOM_SELECTION';
        updateAppView();
    });


    socket.on('created-room', ({roomID_fromServer, roomObj_fromServer}) => {
        localRoomObj = roomObj_fromServer;
        roomID = roomID_fromServer;
        isRoomLeader = true; //sets boolean to true as the creator of the room
        usersObj = localRoomObj.joined_users //initialize usersObj, mirrors the object contained within roomObJ_fromServer
    
        
        console.log (`From Server: Room created with ID of ${roomID_fromServer}`);
        console.log(`local roomID variable set as ${roomID} as a result of creating room`);
        console.log(roomObj_fromServer);

        currentAppState = 'STATE_IN_ROOM';
        updateAppView();
        // Video and player state will be handled by renderInRoomView and subsequent events

    })
    
    socket.on('room-create-fail', () => {
        console.log (`The room attempted to be made by: ${username} could not be created, please try again, or try again later.`);
        const statusMsg = document.getElementById('client-status-message');
        if (statusMsg) statusMsg.innerText = "Failed to join room. Room ID might be invalid or room is full.";
        // No state change
    })

    socket.on('joined-room', ({roomID_fromServer, roomObj_fromServer}) => {
        localRoomObj = roomObj_fromServer;
        roomID = roomID_fromServer;
        usersObj = localRoomObj.joined_users;

        console.log(`Joined room with ID ${roomID_fromServer}`)
        console.log(`local roomID variable set as ${roomID} as a result of joining room`);

        currentAppState = 'STATE_IN_ROOM';
        updateAppView();

        // After view is rendered, apply video state if player is ready
        // Should be robust, player might not be ready immediately
        function applyInitialPlayerState() {
            if (player && typeof player.seekTo === 'function' && localRoomObj.currentVideoLink) {
                player.setPlaybackRate(localRoomObj.currentPlaybackRate);
                player.seekTo(localRoomObj.currentTime, true);
                if (localRoomObj.videoPaused && player.getPlayerState() !== YT.PlayerState.PAUSED) {
                    player.pauseVideo();
                } else if (!localRoomObj.videoPaused && player.getPlayerState() !== YT.PlayerState.PLAYING) {
                    player.playVideo();
                }
            } else if (localRoomObj.currentVideoLink) { // If video link exists but player not ready, retry
                setTimeout(applyInitialPlayerState, 500);
            }
        }
        if (localRoomObj.currentVideoLink) {
             setTimeout(applyInitialPlayerState, 750); // Initial delay for player API
        }
    });

    socket.on('room-join-fail', () => {
        console.log(`Room join failed.`);
        const statusMsg = document.getElementById('client-status-message');
        if (statusMsg) statusMsg.innerText = "Failed to join room. Room ID might be invalid or room is full.";
        // No state change
    });

    socket.on('update-users-list', ({usersInRoom_fromServer}) => {
        console.log('Received update-users-list event:', usersInRoom_fromServer);
        if (currentAppState === 'STATE_IN_ROOM') 
        {
            // Ensure the data is valid before updating the local `users` object to match server data
            if (usersInRoom_fromServer && typeof usersInRoom_fromServer === "object") 
            {
                usersObj = usersInRoom_fromServer;
                console.log(`new users list is: ${JSON.stringify(usersObj)}`);
                renderUsersList();
            }
            else 
            {
                console.log("Users list is not available or invalid");
            }

        }
    
    });

    //Listens for when a message is received, if connected to the/any room
    //("if connected" condition enforced locally and server side)
    //--------------------------------------------------------------------------------------
    socket.on('message', (message) => {
        if (currentAppState === 'STATE_IN_ROOM') {
            const messageContainer = document.getElementById('message-container');
            if (messageContainer) {
                const messageElement = document.createElement('div');
                messageElement.innerText = message;
                messageContainer.appendChild(messageElement); // Display the received message on the page by appending it within 'messageContainer'
                messageContainer.scrollTop = messageContainer.scrollHeight; // Scroll to bottom
            }
        }
    });

    //Listen for when someone else leaves the room
    //--------------------------------------------------------------------------------------
    socket.on('user-left', ({socketID, roomID, username}) => {
        console.log(`User ${username} with socket ID ${socketID} has left room ${roomID}`)
        renderUsersList();
    });

    //Listens for 'error' events containing messages are emitted from the server
    //--------------------------------------------------------------------------------------
    socket.on('error', (errorMessage) => {
        console.log(`Error from server: ${errorMessage}`);
        alert(errorMessage); // Optionally show an alert to the user
        // might do a more graceful error display than alert()
        // Potentially a STATE_ERROR and renderErrorView()
    });


    //? Video Socket Functions

    // Receiving and handling video player updates from room leaders 
    // Interactions are to be done through Youtube API, once a valid youtube video link is loaded
    //--------------------------------------------------------------------------------------
    socket.on('set-videoLink', (videoLink_fromServer) => {
        if (currentAppState === 'STATE_IN_ROOM' && typeof videoLink_fromServer === 'string' ) {
            // videoLink = videoLink_fromServer; // Global videoLink might be redundant if localRoomObj has it
            if (localRoomObj) localRoomObj.currentVideoLink = videoLink_fromServer;
            setVideo(videoLink_fromServer);
            console.log (`From server: Video link set to ${videoLink_fromServer}`)
        }
    });

    socket.on('videoTime-set', (time_fromServer) => {
        if (currentAppState === 'STATE_IN_ROOM' && player && player.seekTo) {
            if (Math.abs(player.getCurrentTime() - time_fromServer) > 2) { // Only seek if significant diff
                player.seekTo(time_fromServer, true); // true for allowSeekAhead
                console.log(`Playback time updated to: ${time_fromServer} seconds by server.`);
            }
        }
        {
            console.warn("Issue when receiving/setting videoTime-set req from server");
        }
    });

    socket.on('video-paused', (pause_message) => {
        
        //checks if the player and the videoPaused api/function are ready and available
        if (currentAppState === 'STATE_IN_ROOM' && player && player.pauseVideo && player.getPlayerState() !== YT.PlayerState.PAUSED) {
            player.pauseVideo();
            if(localRoomObj) localRoomObj.videoPaused = true;
            console.log(pause_message);
        }
        else console.warn('request from server to pause recieved but could not pause for some reason');
    });

    socket.on('video-played', (play_message) => {
       if (currentAppState === 'STATE_IN_ROOM' && player && player.playVideo && player.getPlayerState() !== YT.PlayerState.PLAYING) {
            player.playVideo();
            if(localRoomObj) localRoomObj.videoPaused = false;
            console.log(play_message);
        }
        else console.warn('request from server to play recieved but could not play for some reason');
    });

    socket.on('playbackRate-set', (rate_fromServer) => {
        console.log('playback rate set by another user');
        if (currentAppState === 'STATE_IN_ROOM' && player && player.setPlaybackRate) {
            player.setPlaybackRate(rate_fromServer);
        }
    });
    //--------------------------------------------------------------------------------------

    

})