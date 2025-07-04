"use strict";
//----------------------------------------------------------------
//! Initial Session logic
let sessionID = sessionStorage.getItem('sessionID');
if (!sessionID)
{
    sessionID = Math.random().toString(36).substring(2);
    sessionStorage.setItem('sessionID', sessionID);
    console.log('No sessionID for this tab. New one created:', sessionID);
}
else
{
    console.log('Existing sessionID for this tab found:', sessionID);
}

// Declare socket here but initialize once DOM content loaded
let socket;
//----------------------------------------------------------------

//? Global variables (User side)
let currentAppState = 'STATE_LOADING'; // Start with a loading state perhaps

let username = "";
let socketID = "";
let isRoomLeader = false; 
let localRoomObj = ""; //room Obj containing inner users object, user count (int), current roomLeader object { socketID : username }, messages object, current video link (string), currentTime, currentPlaybackRate
let usersObj = {}  
let roomID = "";
let playerReady = false;


//?------------YT API MUST BE IN GLOBAL SCOPE AS IS DONE HERE, NOT WITHIN `DOMContentLoaded`---------//
// 1. Load the YouTube IFrame Player API code asynchronously
let tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
let firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
console.log(`Tag is: ${tag}`);

let player;

// 2. This will call initializePlayer() when the iFrame is ready
function onYouTubeIframeAPIReady() 
{
    console.log('YouTube API ready'); // Debugging statement
    
    try 
    {
        setTimeout(initializePlayer, 500);
    }
    catch (error)
    {
        console.log(`initializePlayer error: ${error}`);
    }
}

// 3. This function creates a player object for the existing iframe
//For the player variable to be initialzed, or re-initialized when the selected video changes
function initializePlayer() 
{
    //Destroys existing player if it exists
    if (player)
    {
        player.destroy();  
        console.log('player object has been destroyed');
    }
    //Grabs iframe element based on id 'yt-iframe', as is set in index.html
    player = new YT.Player('yt-iframe', 
    {
        events: {
            'onReady': onPlayerReady, 
            'onStateChange': onPlayerStateChange, 
            'onPlaybackRateChange': onPlayerPlaybackRateChange, 
            'onError': onPlayerError,
        }
    }); 
    console.log(`initializePlayer() has ran. Player object has a value of: ${JSON.stringify(player)}`);
    
}


//Applies a given state object to the YouTube player.
//@param {object} state An object with { currentTime, videoPaused, currentPlaybackRate }
function applyPlayerState(state) 
{
    if (!player || !playerReady) 
    {
        console.warn("Tried to apply state, but player is not ready.");
        return;
    }

    console.log("Applying player state:", state);

    player.setPlaybackRate(state.currentPlaybackRate);
    player.seekTo(state.currentTime, true);

    // Use a timeout to ensure seekTo has initiated before play/pause
    setTimeout(() => {
        if (state.videoPaused) 
        {
            if (player.getPlayerState() !== YT.PlayerState.PAUSED) 
            {
                player.pauseVideo();
            }
        } 
        else 
        {
            if (player.getPlayerState() !== YT.PlayerState.PLAYING) 
            {
                player.playVideo();
            }
        }
    }, 500);
}


function onPlayerReady(event) 
{
    console.log('onPlayerReady called');
    playerReady = true;

    const iframe = document.getElementById('yt-iframe');
    if (iframe) // Double check if the iframe exists and stylize is
    {
        iframe.style.borderColor = '#FF6D00';
        iframe.style.borderWidth = '2px';
    }

    //Determine logic based on user's role (is in room/is leader)
    if (isRoomLeader)
    {
        // For the leader, onPlayerReady only fires AFTER a video has been set. The autoplay=1 parameter in the URL should handle starting the video.
        // No need to explicitly call playVideo() here. The onPlayerStateChange event will fire when playback starts, and that's when the server is notified.
        console.log("Player is ready. As leader, autoplay should handle playback.");
    }
    else if (!isRoomLeader && currentAppState === 'STATE_IN_ROOM' && localRoomObj) 
    {
        // This is a non-leader who has just joined and their player is ready, so they should ask the server for the leaders live state
        console.log("Player is ready. Requesting initial video state from server...");

        socket.timeout(5000).emit('request-initial-sync', roomID, (err, stateObj_FromServer) => 
        {
            //console.log(`Err: ${JSON.stringify(err)}, stateObj_FromServer: ${JSON.stringify(stateObj_FromServer)}`);

            // This is called if the server or leader doesn't respond in time (5 seconds)
            if (err) 
            {
                console.error("Err: Could not complete initial auto-sync with leader:", err);
                alert("Could not complete initial auto-sync with the room leader. They may be unresponsive.");
                return;
            }
            if (stateObj_FromServer === null || typeof stateObj_FromServer === "undefined")
            {
                console.warn("Received 'stateFromServer' object that should originate from the leader, but it's null/undefined...");
                return;
            }

            // ----- Otherwise state acquired, so continue ------
            
            // First Update localRoomObj (even if not crucial/may be redundant)
            if (localRoomObj) 
            {
                localRoomObj.currentTime = stateObj_FromServer.currentTime;
                localRoomObj.videoPaused = stateObj_FromServer.videoPaused;
                localRoomObj.currentPlaybackRate = stateObj_FromServer.currentPlaybackRate;
            }
            else if (!localRoomObj)
            {
                console.warn("no local room obj!");
            }

            console.log("Succesfully received initial state from leader:", stateObj_FromServer);
            console.log(`Player ready in room. Syncing to room state: Time=${stateObj_FromServer.currentTime}, Paused=${stateObj_FromServer.videoPaused}, Rate=${stateObj_FromServer.currentPlaybackRate}`);

            setTimeout(() => 
            {
                player.seekTo(stateObj_FromServer.currentTime, true);
                player.setPlaybackRate(stateObj_FromServer.currentPlaybackRate);

                if (stateObj_FromServer.videoPaused) {
                    if (player.getPlayerState() !== YT.PlayerState.PAUSED) {
                        player.pauseVideo();
                    }
                } 
                else {
                    if (player.getPlayerState() !== YT.PlayerState.PLAYING) {
                        player.playVideo();
                    }
                }
            }, 200); // Small delay to ensure seekTo has initiated //! try removing this set time out and test if needed

        });
    }
    else 
    {
        // Fallback for unexpected state
        console.log('Player is ready, but not in a room. Defaulting to play video.');
        playerInstance.playVideo();
    }
    
}

//-1: unstarted, 0: ended, 1: playing, 2: paused, 3: buffering, 4: video cued
function onPlayerStateChange(event)
{                       
    console.log('Player state changed to:', event.data);
    console.log(`Current time: ${Math.floor(player.getCurrentTime())} `);
    
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

// Emits to to server when user changes the playback rate. Rate = 0.25 | 0.5 | 0.75 | 1 | 1.25 | 1.5 | 1.75 | 2;
// ALso takes the opportunity to trigger a sync/update for the current video time
function onPlayerPlaybackRateChange(event) 
{
    if (isRoomLeader) 
    {
        // First re-sync time
        const currentTime = player.getCurrentTime();
        console.log('Syncing video time for non-leaders');
        socket.emit('set-videoTime', {currentTime, roomID});

        // Then set playback rate
        console.log('Playback rate changed to:', event.data);  
        socket.emit('set-playbackRate', {playbackRate_eventData: event.data, roomID});

    }
}

//2: The req contains an invalid parameter value. 
//5: The request cannot be played in an HTML player or another related error. 
//100: The requested vidoe was not found.
//101: The owner of the requested video does not allow embedding
//150: Same as 101, it's just error 101 in disguise 
function onPlayerError(event) 
{                             
    console.log('Error occurred:', event.data);
    window.alert('Error');
    //todo improve specificity and presentation
}
// ?End of YT api setup (global scope)
//?==================================================================================================================//


document.addEventListener('DOMContentLoaded', () => 
{
    
    //! Initialize socket here as the first step
    socket = io('http://localhost:3000', {auth: {sessionID: sessionID}});
    
    //! Initial call to render UI
    updateAppView(); // This will render the initial state (e.g., loading or username prompt)
    

    //? ======================== State based rendering functions =============================//

    function updateAppView() 
    {
        const appContainer = document.getElementById('app-container');
        if (!appContainer) 
        {
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
                    <button type="submit" id="submit-videolink-button" ${videoLinkDisabled}>Set Video</button>
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
                <button id="leaveRoom-button" type="button" style="margin-top: 10px;">Leave Room</button>
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
    //? ----------- End of Application State Management & View Functions -----------------


    
    
    //? ============================= DOM Event Handler Functions =====================================//
    function handleUsernameSubmit(event) 
    {
        event.preventDefault();
        const usernameInput = document.getElementById('username-input');

        if (usernameInput && usernameInput.value.trim() && typeof usernameInput.value === "string") 
        {          
            const proposedUsername = usernameInput.value.trim();
            // Basic sanitization: allow letters, numbers, spaces, underscores, hyphens. Max length.
            if (proposedUsername.length > 20 || !/^[a-zA-Z0-9_ -]+$/.test(proposedUsername)) {
                alert("Username can only contain letters, numbers, spaces, underscores, hyphens and be 20 characters at most.");
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


    function handleCreateRoom(event) 
    {
        event.preventDefault();

        const statusMsg = document.getElementById('client-status-message');
        if (statusMsg) statusMsg.innerText = "Creating room...";
        socket.emit('create-room', { username });
    }


    function handleJoinRoom(event) 
    {
        event.preventDefault();
        const roomJoinInput = document.getElementById('roomJoin-input');
        const statusMsg = document.getElementById('client-status-message');

        if (roomJoinInput && roomJoinInput.value.trim() && typeof roomJoinInput.value === "string") {
            if (statusMsg) statusMsg.innerText = "Joining room...";
            const req_roomID = roomJoinInput.value.trim();
            socket.emit('join-room', { req_username: username, req_roomID : req_roomID });
        } 
        else 
        {
            alert("Room ID cannot be empty!");
        }
    }
    

    function handleVideoLinkSubmit(event) 
    {
        event.preventDefault();
        const videoLinkInput = document.getElementById('videolink-input');
        if (isRoomLeader && videoLinkInput && videoLinkInput.value.trim() && typeof videoLinkInput.value === "string") 
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

        //("if conditions enforced by server verification as well)
        if (messageInput && messageInput.value.trim() && roomID && localRoomObj && typeof messageInput.value === "string" ) 
        {
            const message = messageInput.value.trim();
            socket.emit('sendMessage', { message, username, roomID }); // Send an obj containing the message, and roomID to the server
            messageInput.value = '';
        }
    }

    // Triggered when user presses "leave room"
    function handleLeaveRoom() 
    {
        if (localRoomObj && roomID) 
        {
            console.log(`Leaving room: ${roomID}`);
            socket.emit('user-leaves-room', { roomID : roomID}); // Server knows socket.id

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
    

    //? ================ Utility Functions (renderUsersList, setVideo, verifyLink) ===================//
    function renderUsersList() 
    {
        if (currentAppState = 'STATE_IN_ROOM')
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
                console.log("Users list is not available/invalid.");
                userListDiv.innerHTML = '<li>No joined users object.</li>';
                return;
            }
            
            // First clear the current list
            userListDiv.innerHTML = '';

            // Setup array of the IDs of the currently joined users
            const joinedUsers_socketIDs = Object.keys(usersObj);
            
            // Ensure users object/array is not empty
            if (joinedUsers_socketIDs.length === 0) 
            {
                console.log('Unexpected: The usersObj seems to be empty.');
                userListDiv.innerHTML = '<li>No users in room.</li>';
                return;
            }
        
            // For each id (joiner user), setup a user element and 'make leader' button and conditionally append the button
            for (const id of joinedUsers_socketIDs) 
            {
                const userElement = document.createElement('div');
                // userElement.style = "display: flex; justify-content: space-between;";
                userElement.innerText = usersObj[id] + (localRoomObj && localRoomObj.roomLeader && localRoomObj.roomLeader[id] ? '     👑' : '');
                userElement.id = `userID-${id}`; // Ensure unique user-based ID for each listed user in the left panel
            
                const makeLeaderButton = document.createElement('button');
                makeLeaderButton.classList.add('make-leader-button');
                makeLeaderButton.type = 'button';
                makeLeaderButton.innerText = 'Make Leader';
                makeLeaderButton.id = `button-user-${id}`;
                makeLeaderButton.addEventListener('click', (event) => {handleManualLeaderChangeRequest(id)})
                
                // Ensures 'make leader' button only appears to the room leader, for other non leaders in the room 
                if (isRoomLeader && !localRoomObj.roomLeader[id])
                {
                    userElement.appendChild(makeLeaderButton);
            
                }
                userListDiv.appendChild(userElement);

            }
        }
        
    }

    
    function handleManualLeaderChangeRequest(targetSocketID) 
    {
        socket.emit('roomLeader-changeRequest', {newLeaderID : targetSocketID, roomID : roomID});
        console.log(`Newly chosen leader has socketID: ${targetSocketID}, executing 'roomLeader-changeRequest'`);
    }


    function verifyLink(link) 
    {
        let videoId = null;

        // Regex to capture video ID from various YouTube URL formats
        const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        // Explanation:
        // (?:https?:\/\/)? : Optional http or https, (?:www\.)? : Optional www., youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/) : Matches youtube.com followed by common paths, |youtu\.be\/ : OR matches youtu.be/, ([a-zA-Z0-9_-]{11}) : Captures the 11-character video ID

        const match = link.match(youtubeRegex);

        if (match && match[1]) 
        {
            videoId = match[1];
        } 
        else 
        {
            console.log('Link did not match any known YouTube regex or no video ID found');
            return false;
        }

        // Base embed URL
        const baseEmbedUrl = `https://www.youtube.com/embed/${videoId}`;

        try 
        {
            // Create a URL object. If the link doesn't have a protocol, prepend https.
            // This is a bit simplified; a full URL parser might be needed for edge cases of partial URLs.
            const fullLinkForParsing = (link.startsWith('http://') || link.startsWith('https://')) ? link : `https://${link}`;
            const url = new URL(fullLinkForParsing); // Use the original link to preserve existing params
            const params = new URLSearchParams(url.search);

            // Set desired parameters (will overwrite if they exist, or add if they don't)
            params.set('autoplay', '1');
            params.set('enablejsapi', '1');

            return `${baseEmbedUrl}?${params.toString()}`;

        } 
        catch (e) 
        {
            // Fallback if the original link was too malformed for the URL constructor,
            // but we have the videoId.
            console.warn('Original link was not a valid URL for param parsing, constructing fresh embed URL:', e.message);
            return `${baseEmbedUrl}?autoplay=1&enablejsapi=1`;
        }
    }   


    function setVideo(link) // VerifyLink should run before this happens
    { 
        const videoWrapper = document.getElementById('video-wrapper');
        if (!videoWrapper) 
        {
            console.error("Video wrapper not found");
            return;
        }
        
        // Verify if user is in a room context and if link input is of type string
        if (username && roomID && typeof link === "string") 
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


    //? ======================== Socket Event Functions ==================================
    socket.on('on-connection', (socketID_fromServer) => 
    { 
        console.log(`You have ID: ${socketID_fromServer} and have succesfully connected! Your username is not set yet`);
        socketID = socketID_fromServer; // Update the local socketID variable 
        
        currentAppState = 'STATE_SET_USERNAME';
        updateAppView(); 
    });

    
    socket.on('username-set', (username) => 
    {
        console.log(`Server confirmation: Username succesfully set as ${username}`);
        currentAppState = 'STATE_ROOM_SELECTION';
        updateAppView();
    });


    socket.on('created-room', ({roomID_fromServer, roomObj_fromServer}) => 
    {
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
    
    socket.on('room-create-fail', () => 
    {
        console.log (`The room attempted to be made by: ${username} could not be created, please try again, or try again later.`);
        const statusMsg = document.getElementById('client-status-message');
        if (statusMsg) statusMsg.innerText = "Failed to join room. Room ID might be invalid or room is full.";
        // No state change
    })

    socket.on('joined-room', ({roomID_fromServer, roomObj_fromServer}) => 
    {
        localRoomObj = roomObj_fromServer;
        roomID = roomID_fromServer;
        usersObj = localRoomObj.joined_users;

        console.log(`Joined room with ID ${roomID_fromServer}`)
        console.log(`local roomID variable set as ${roomID} as a result of joining room`);

        currentAppState = 'STATE_IN_ROOM';
        updateAppView();
    
    });

    socket.on('get-current-video-state', (callbackToServer) => 
    {
        console.log("Leader received 'get-current-video-state' event!");
        console.log(`Server is requesting my current video state. My status: isRoomLeader = ${isRoomLeader}, playerReady = ${playerReady}`);
        
        // Check initial conditions first
        if (isRoomLeader && playerReady && player && typeof player.getPlayerState === 'function') 
        {
            // Update local copy of room object first 
            // Not particularly necessary/useful but no impact on function or performance)
            localRoomObj.currentTime = Math.floor(player.getCurrentTime()); 
            
            // Get the raw player state number (e.g., 1 for playing, 2 for paused);
            const rawPlayerState = player.getPlayerState();

            // Determine if paused without relying on YT.PlayerState constant
            // Any state that isn't exactly 1 (PLAYING) can be considered "not playing"
            const isPaused = (rawPlayerState !== 1);

            const currentState_fromLeader = {
                currentTime: Math.floor(player.getCurrentTime() || 0),  // Default to start of the video if current time not available
                videoPaused: isPaused, 
                currentPlaybackRate: player.getPlaybackRate() || 1  // Default to 1.0x playback speed as backup
            };
            
            console.log(`As leader, I'm sending the object in the callback: ${currentState_fromLeader}}`);
            callbackToServer(currentState_fromLeader); // Success, finish callback back to server with the prepared object
        } 
        else 
        {
            console.log("Failed to provide state. Passing null to the callback.");
            callbackToServer(null);
        }
    });
    
    
    socket.on('room-join-fail', () => 
    {
        console.log(`Room join failed.`);
        const statusMsg = document.getElementById('client-status-message');
        if (statusMsg)
        {
            statusMsg.innerText = "Failed to join room. Room ID might be invalid, or the room is full.";
        }
        // No state change
    });

    socket.on('update-users-list', ({usersInRoom_fromServer}) => 
    {
        console.log('Received update-users-list event:', usersInRoom_fromServer);
        if (currentAppState === 'STATE_IN_ROOM') 
        {
            // Ensure the data is valid before updating the local `users` object to match server data
            if (usersInRoom_fromServer && typeof usersInRoom_fromServer === "object") 
            {
                usersObj = usersInRoom_fromServer; // Update local copy of usersObj
                localRoomObj.joined_users = usersInRoom_fromServer; // Mirror this update in the joined_users object contained within localRoomObj

                console.log(`new users list is: ${JSON.stringify(usersObj)}`);
                renderUsersList();
            }
            else 
            {
                console.log("Users list is not available or invalid");
            }

        }
    
    });

    // Listens for when the leader changes and updates the client environment
    socket.on('new-leader-assigned', ({newLeaderID : newLeaderSocketID_fromServer, newLeaderUsername: newLeaderUsername_fromServer}) => 
    {
        console.log(`Server Message: Attempting to assign new leader with username ${newLeaderUsername_fromServer}`);

        // Find the video submit in the current DOM and submit form
        const submitVideoButton = document.getElementById('submit-videolink-button');
        const videoLinkInput = document.getElementById('videolink-input');

        // Update the local room object (and isRoomLeader status only for the new leader client)
        if (localRoomObj) 
        {
            localRoomObj.roomLeader = { [newLeaderSocketID_fromServer] : newLeaderUsername_fromServer };
            
            // If this client is the new leader, update isRoomLeader boolean and update the DOM, then re-render the users list
            if (socketID === newLeaderSocketID_fromServer)
            {
                isRoomLeader = true;

                if (submitVideoButton && videoLinkInput)
                {
                    submitVideoButton.removeAttribute('disabled');
                    videoLinkInput.removeAttribute('disabled');
                    videoLinkInput.setAttribute('placeholder' , 'Enter YouTube Video URL')
                }
                console.log ("You are now the room leader!");
                renderUsersList();
            }
            else 
            {
                // If this client is not currently the leader then ensure isRoomLeader is false, update DOM, re-render the users list
                isRoomLeader = false;

                if (submitVideoButton && videoLinkInput)
                {
                    submitVideoButton.setAttribute('disabled', 'true');
                    videoLinkInput.setAttribute('disabled', 'true');
                    videoLinkInput.setAttribute('placeholder' , 'Only room leader can change video')
                }
                renderUsersList();
            }
        }
        else 
        {
            console.warn('Unexpected: localRoomObj missing');
        }

    });

    //Listens for when a message is received, if connected to the/any room
    //("if connected" condition enforced locally and server side)
    //--------------------------------------------------------------------------------------
    socket.on('message', (message) => 
    {
        if (currentAppState === 'STATE_IN_ROOM') {
            const messageContainer = document.getElementById('message-container');
            if (messageContainer) 
            {
                const messageElement = document.createElement('div');
                messageElement.innerText = message;
                messageContainer.appendChild(messageElement); // Display the received message on the page by appending it within 'messageContainer'
                messageContainer.scrollTop = messageContainer.scrollHeight; // Scroll to bottom
            }
        }
    });

    //Listen for when someone else leaves the room
    //--------------------------------------------------------------------------------------
    socket.on('user-left', ({socketID, roomID, username}) => 
    {
        console.log(`User ${username} with socket ID ${socketID} has left room ${roomID}`)
        renderUsersList();
    });

    //Listens for 'error' events containing messages are emitted from the server
    //--------------------------------------------------------------------------------------
    socket.on('error', (errorMessage) => 
    {
        console.log(`Error from server: ${errorMessage}`);
        alert(errorMessage); // Optionally show an alert to the user
        
        // Todo: more graceful error display than using pop-up alert()
        // Potentially a STATE_ERROR and renderErrorView()
    });



    //? ========================= Video Socket Functions ===================================

    // Receiving and handling video player updates from room leaders 
    // Interactions are to be done through Youtube API, once a valid youtube video link is loaded
    //--------------------------------------------------------------------------------------
    socket.on('set-videoLink', (videoLink_fromServer) => 
    {
        if (currentAppState === 'STATE_IN_ROOM' && typeof videoLink_fromServer === 'string' ) 
        {
            // videoLink = videoLink_fromServer; // Global videoLink might be redundant if localRoomObj has it
            if (localRoomObj) localRoomObj.currentVideoLink = videoLink_fromServer;
            setVideo(videoLink_fromServer);
            console.log (`From server: Video link set to ${videoLink_fromServer}`)
        }
    });

    socket.on('videoTime-set', (time_fromServer) => 
    {
        if (currentAppState === 'STATE_IN_ROOM' && player && player.seekTo) 
        {
            // Only call player.seekTo if there is a significant difference (over 2 seconds)
            if (Math.abs(player.getCurrentTime() - time_fromServer) > 2)
            {
                player.seekTo(time_fromServer, true); // true for allowSeekAhead
                console.log(`Playback time updated to: ${time_fromServer} from server.`); 

            }
        }
        else 
        {
            console.warn("Issue receiving/setting videoTime-set from server");
        }
    });

    socket.on('video-paused', (pause_message) => 
    {
        
        //checks if the player and the videoPaused api/function are ready and available
        if (currentAppState === 'STATE_IN_ROOM' && player && player.pauseVideo && player.getPlayerState() !== YT.PlayerState.PAUSED) 
        {
            player.pauseVideo();
            if(localRoomObj) localRoomObj.videoPaused = true;
            console.log(pause_message);
        }
        else console.warn('request from server to pause recieved but could not pause for some reason');
    });

    socket.on('video-played', (play_message) => 
    {
       if (currentAppState === 'STATE_IN_ROOM' && player && player.playVideo && player.getPlayerState() !== YT.PlayerState.PLAYING) 
        {
            player.playVideo();
            if(localRoomObj) localRoomObj.videoPaused = false;
            console.log(play_message);
        }
        else console.warn('request from server to play recieved but could not play for some reason');
    });

    socket.on('playbackRate-set', (rate_fromServer) => 
    {
        console.log('playback rate changed by leader');
        if (currentAppState === 'STATE_IN_ROOM' && player && player.setPlaybackRate) 
        {
            player.setPlaybackRate(rate_fromServer);
        }
    });
    //--------------------------------------------------------------------------------------

}) // END OF DOM-CONTENT-LOADED



//* --------client side debug function-------------
function printStatus() 
{
    console.log(`Username: ${username}`);
    console.log(`Is room leader: ${isRoomLeader}`);
    console.log(`SocketID: ${socketID}`);
    console.log(`roomID: ${roomID}`);
    console.log(`Current video ${localRoomObj.currentVideoLink? localRoomObj.currentVideoLink : "No Video Selected" }`);
    console.log(`Current View state: ${currentAppState}`);
    console.log(`Player Ready: ${playerReady}`);
}