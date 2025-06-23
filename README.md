# ChatApp (YouTube Sync Room)

A real-time web app for watching YouTube videos together, with chat and synchronized playback, built with Node.js, Express, and Socket.IO.

---

## Features

- Create or join private rooms with a unique Room ID
- Synchronized YouTube video playback (play, pause, seek, playback rate)
- Real-time chat for each room
- Room leader system (only one leader at a time, can transfer control)
- User list with leader transfer button
- Automatic leader reassignment if the leader leaves

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16+ recommended)
- [npm](https://www.npmjs.com/)

### Installation

```bash
git clone https://github.com/yourusername/chatapp.git
cd chatapp
npm install
```

### Running the App

```bash
npm start
```
- The app will run on [http://localhost:3000](http://localhost:3000) by default.
- The `start` script uses [nodemon](https://www.npmjs.com/package/nodemon) for automatic server restarts during development.

---

## Dependencies

- [express](https://www.npmjs.com/package/express)
- [socket.io](https://www.npmjs.com/package/socket.io)
- [socket.io-client](https://www.npmjs.com/package/socket.io-client)
- [generate-unique-id](https://www.npmjs.com/package/generate-unique-id)

### Dev Dependencies

- [nodemon](https://www.npmjs.com/package/nodemon) - for auto-restarting the server during development
- [concurrently](https://www.npmjs.com/package/concurrently) - for running multiple commands in parallel (not currently used in scripts, but available)

---

## Usage

- Open the app in your browser.
- Set a username.
- Create a new room or join an existing one using a Room ID.
- If you are the room leader, set a YouTube video link to start watching together.
- Use the chat to communicate with others in the room.
- The room leader can transfer control to another user.

---

## Planned Features / TODO

- Persistent chat history (server-side and for new joiners)
- Database integration (MongoDB)
- User authentication (optional)
- Improved error handling and UI feedback

---

## License

...

---

