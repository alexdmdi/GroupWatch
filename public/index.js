// import {io} from 'socket.io-client';
const socket = io('http://localhost:3000'); //Initialize socket.io client

//------------YT API MUST BE IN GLOBAL SCOPE AS IS DONE HERE, NOT WITHIN `DOMContentLoaded`---------//
// 1. Load the YouTube IFrame Player API code asynchronously
let tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
let firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
console.log(`tag is: ${tag}`);

let player;
let videoNumber = 0; //counts how many videos have been played -- delete this later?

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
    if (player){
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
    
    if (event.data === 1) {
        socket.emit('set-videoTime', Math.floor(player.getCurrentTime()));   //!seems to be causing issue?
        socket.emit('play-video', 'Video played');
    }
    if (event.data === 2)
    {
        console.log('video paused by you');
        socket.emit('pause-video', 'Video paused');
    }
    
}

//emits to to server when user changes the playback rate. Rate = 0.25 | 0.5 | 1 | 1.5 | 2;
function onPlayerPlaybackRateChange(event) {
    console.log('Playback rate changed to:', event.data);  
    socket.emit('set-playbackRate', event.data);
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


//--------------------------------------------------------------------------------------------------------------------//
document.addEventListener('DOMContentLoaded', () => {

    let username = "";
    let socketID = "";
    let localRoom = "";
    let isRoomLeader = false; 
    let users = {}  //!maybe remove if implementing users obj from the room object?
    
    const usernameForm = document.getElementById(`username-form`);
    const usernameInput = document.getElementById(`username-input`);
    const userList = document.getElementById('user-list');

    const nonEmbedLinkRegex = /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=([^&]+)/; //for yt video URLs that follow pattern: https://www.youtube.com/watch?v=ID or www.youtube.com/watch?v=ID  -- double check these comments
    const embedLinkRegex = /^(https:\/\/)?(www\.)?youtube\.com\/embed\/.+$/;           //for yt video URLs that follow pattern: https://www.youtube.com/embed/ID
    const wwwEmbedLinkRegex = /^www\.youtube\.com\/embed\/([^&]+)/;                    //for yt video URLs that follow pattern: www.youtube.com/embed/ID

    // let messages = {}; //!to implement potentially
    const messageContainer = document.getElementById('message-container');
    const sendContainer = document.getElementById('send-container');
    const messageInput = document.getElementById('message-input');

    const roomCreateForm = document.getElementById('roomCreate-form');
    const roomJoinForm = document.getElementById('roomJoin-form');

    const clientStatusMessage = document.getElementById('client-status-message');

    let videoLink = "";
    const videoWrapper = document.getElementById('video-wrapper');
    const videoLinkForm = document.getElementById('videolink-form');
    const videoLinkInput = document.getElementById('videolink-input');  
    const submitVideoLinkButton = document.getElementById('submit-videolink');
    
    function renderUsersList() {
        //clears the current list
        userList.style = '';
        userList.innerHTML = '';

        //renders the new list of users
        const socketIDs = Object.keys(users);
        for (const socketID of socketIDs) {
            if (users[socketID] !== ''){
                const userElement = document.createElement('div');
                userElement.innerText = users[socketID]; // Display username
                userElement.id = socketID; // Set the element's ID to the users socket ID
                userList.appendChild(userElement);
            }
        }
        
    }

    //Setting username
    //-----------------------------------------------------------------------------------------------
    usernameForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (usernameInput.value){         //!improve imput sanitization, don't allow code, spaces, or weird characters, max characters 20-25 
    
            username = usernameInput.value.trim();
            
            socket.emit('sendMessage', `${username} has joined!`);
            socket.emit('new-user', username);

            console.log(`User name submitted is: ${username}`);
            usernameInput.value = "";
            messageInput.removeAttribute('disabled');
            messageInput.removeAttribute('placeholder');
            usernameForm.style.display = 'none'; // Hides the username form after submission //!maybe change this so that it fully removes the element?

            videoLinkInput.removeAttribute('disabled');
            videoLinkInput.removeAttribute('placeholder');
            
            // submitVideoLinkButton.removeAttribute('disabled')

            roomCreateForm.innerHTML = ` 
            <button type = "submit" id="submit-roomCreate" style="display: block; margin-bottom: 10%">Create a private room</button>
            `

            roomJoinForm.innerHTML = `
            <input type="text" id="roomJoin-input" placeholder="Join an existing room" >
            <button type="submit" id="joinRoom-button">Join</button>
            `
        }
        else {
            window.alert("Username cannot be empty!");
        }

    })
    
    socket.on('username-set', (usersObjFromServer) => {
        users = usersObjFromServer;
        renderUsersList();
        console.log(`Users list is: ${JSON.stringify(users)}`);
    });

    
    
    //Creating a room
    //-----------------------------------------------------------------------------------------------
    roomCreateForm.addEventListener('submit', (e) => {
        e.preventDefault();      
        
        console.log(`Creating Room...`);
        clientStatusMessage.innerText = "Trying to create a room..."
        socket.emit('create-room', [username, socketID]);
        
    })

    socket.on('created-room', ([roomID_fromServer, roomObj_fromServer]) => {
        localRoom = roomObj_fromServer;

        // console.log (`From Server: Room created with ID of ${localRoom.roomID}`);
        console.log (`From Server: Room created with ID of ${roomID_fromServer}`);
        console.log(roomObj_fromServer);

        clientStatusMessage.remove();
        videoLinkForm.style="display: inline;"
        roomCreateForm.innerHTML = "";
        roomJoinForm.innerHTML = "";

        renderUsersList();


    })
    
    socket.on('room-create-fail', () => {
        console.log (`The room attempted to be made by: ${username} could not be created, please try again, or try again later. If the issue persists, contact support.`);
    })



    //Joining a room 
    //-----------------------------------------------------------------------------------------------
    roomJoinForm.addEventListener('submit', (e) => {
            e.preventDefault();
            let roomJoinInput = document.getElementById('roomJoin-input');
            
            let joinRequestObj = {
                "username": username,
                "socketID": socketID,
                "roomID": roomJoinInput.value
            }
            console.log(`Sending join request obj to server with roomID set as: ${roomJoinInput.value}`);
            socket.emit('join-room', joinRequestObj);     
        
    })

    socket.on('joined-room', (roomID_fromServer) => {
        console.log(`Joined room with ID ${roomID_fromServer}`)
    });

    socket.on('room-join-fail', () => {
        console.log(`User has tried to join a room with an invalid room ID`);
        clientStatusMessage.innerText = "A room with this ID does not exist"
    })

    //Client leaves the room but stays connected
    //-----------------------------------------------------------------------------------------------
    function leaveRoom() {
        if (localRoom) {
            console.log(`Leaving room: ${localRoom}`);
            socket.emit('user-leaves-room', { roomID: localRoom, socketID });
            localRoom = ""; // Clear the local room variable
            renderUsersList(); // Clear the user list on the client side
        } else {
            console.log("You are not in a room.");
        }
    }


    
    //Listen for when someone else joins current room
    //-----------------------------------------------------------------------------------------------
    socket.on('update-users-list', (usersInRoom) => {
        // Update the local users object to match the server's data
        users = usersInRoom;
        console.log(`new users list is: ${JSON.stringify(users)}`);
    
        renderUsersList();
    });


    //Listen for when someone else leaves the room
    //-----------------------------------------------------------------------------------------------
    socket.on('user-left', ({socketID, roomID}) => {
        console.log(`User has left room ${roomID}`)
        renderUsersList();
    });


    // Client user fully disconnects (closes the tab or loses connection)
    //-----------------------------------------------------------------------------------------------
    window.addEventListener('beforeunload', () => {
        socket.emit('user-disconnect', username);
    });

    socket.on('user-disconnected', ([username, socketID]) => {
        const disconnectedUser = document.getElementById(socketID); 
        disconnectedUser.remove(); // removes element from left side user list

    });


    //?----------------Next section-------------------------------------------------------------------




    function convertToEmbedUrl(url) {
        const convertedUrl = url.replace(nonEmbedLinkRegex, 'https://www.youtube.com/embed/$3');
        console.log(`Converted URL: ${convertedUrl}`);
        return convertedUrl;
    }

    function verifyLink(link) {
        if (wwwEmbedLinkRegex.test(link)) {
            console.log('Link matches wwwEmbedLinkRegex');
            return `https://${link}?autoplay=1&enablejsapi=1`;
        } else if (embedLinkRegex.test(link)) {
            console.log('Link matches embedLinkRegex');
            return (link + '?autoplay=1&enablejsapi=1');
        } else if (nonEmbedLinkRegex.test(link)) {
            console.log('Link matches nonEmbedLinkRegex');
            return (convertToEmbedUrl(link) + '?autoplay=1&enablejsapi=1');
        } else {
            console.log('Link did not match any regex');
            return false; //In the case that the input given does not match any valid youtube video URL
        }
    }

    function setVideo(link) {
            console.log(`The link was set to: ${link}`)
            videoWrapper.innerHTML = '';
            ++videoNumber;
            videoWrapper.innerHTML = `<iframe id="yt-iframe" width="640" height="360" src="${link}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`
            videoLinkInput.value = '';
            // initializePlayer(); //Reinitialize the player with the new video
            setTimeout(initializePlayer, 500); // Re-initialize the player with the newly set video, but with a delay to ensure the iframe is fully loaded
    }


    //How a client sets the video from their side
    videoLinkForm.addEventListener('submit', (e) => {
        e.preventDefault();
        videoLink = videoLinkInput.value; 
        let verifiedLink = verifyLink(videoLink)
        
        if (verifiedLink) {
            console.log(`verifiedLink is: ${verifiedLink}`);
            setVideo(verifiedLink);
            socket.emit('videoLink-set', verifiedLink);
        }
        else {
            window.alert("Invalid link! Are you sure you entered a YouTube link?");
            console.warning("Setting video failed, link not good");
        }
        
    });

    sendContainer.addEventListener('submit', (e) => {
        e.preventDefault();
        if (messageInput.value.trim()){
            const message = `${username}: ${messageInput.value.trim()}`;
            socket.emit('sendMessage', `${usernameInput.value} ${message}`); // Send the message to the server
            messageInput.value = '';
        }
    });
    
    socket.on('on-connection', (socketID_fromServer) => { 
        console.log(`You have ID: ${socketID_fromServer} and have succesfully connected! Your username is not set yet`);
        socketID = socketID_fromServer; // Update the local socketID variable 
        
    });
       
    socket.on('message', (message) => {
        const messageElement = document.createElement('div');
        messageElement.innerText = message;
        messageContainer.appendChild(messageElement); // Display the received message on the page by appending it within 'messageContainer'
    });


    //Interacting through Youtube API once valid link is loaded
    //----------------------------------------------------------------
    socket.on('set-videoLink', (videoLink_fromServer) => {
        videoLink = videoLink_fromServer;
        setVideo(videoLink);
    });

    socket.on('videoTime-set', (time_fromServer) => {
    if (player && player.seekTo){
        player.seekTo(time_fromServer);
        console.log(`Playback time has been updated to: ${time_fromServer} seconds`);
    }
    else {
        console.log("Player is not ready to seek");
    }
    });

    socket.on('video-paused', (pause_message) => {
        console.log(pause_message + ' by another user');
        if (player && player.pauseVideo) {
            player.pauseVideo();
        }
        else console.log('request from server to pause recieved but could not pause for some reason');
    });

    socket.on('video-played', (play_message) => {
        if (player && player.playVideo()){
            player.playVideo();
        }
        else console.log('request from server to play recieved but could not play for some reason');
    });

    socket.on('playbackRate-set', (rate_fromServer) => {
        console.log('playback rate set by another user');
        if (player && player.setPlaybackRate){
            player.setPlaybackRate(rate_fromServer);
        }
    });
    //----------------------------------------------------------------

    

})