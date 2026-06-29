// const express = require('express');
// const http = require('http');
// const { Server } = require('socket.io');

// const app = express();
// const server = http.createServer(app);
// const io = new Server(server, {
//   cors: { origin: "*" }
// });

// io.on('connection', (socket) => {
//   console.log('User connected:', socket.id);

//   // Handle incoming messages
//   socket.on('send_message', (data) => {
//     // Broadcast message to the specific recipient
//     io.to(data.receiverId).emit('receive_message', {
//       senderId: socket.id,
//       text: data.text
//     });
//   });
// });

// server.listen(5000, () => console.log('Server running on port 5000'));