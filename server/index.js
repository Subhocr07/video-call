const express = require("express");
const app = express();
const http = require("http").createServer(app);
const os = require("os");

// Function to get local IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const dev in interfaces) {
    for (const details of interfaces[dev]) {
      if (details.family === "IPv4" && !details.internal) {
        return details.address;
      }
    }
  }
  return "localhost";
}

// Allow frontend to connect from both localhost and network IP
const localIP = getLocalIP();
const allowedOrigins = "*";

const io = require("socket.io")(http, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3001;
const path = require("path");
const cors = require("cors");

// ✅ Improved CORS settings
const corsOptions = {
  origin: allowedOrigins,
  methods: ["GET", "POST"],
  credentials: true,
};
app.use(cors(corsOptions));

let socketList = {};

// ✅ Serve static files correctly
app.use(express.static(path.join(__dirname, "public")));

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/build")));
  app.get("/*", function (req, res) {
    res.sendFile(path.join(__dirname, "../client/build/index.html"));
  });
}

// ✅ Simple route to check server status
app.get("/ping", (req, res) => {
  res.status(200).send({ success: true });
});

// 🔥 **Socket.IO Implementation**
io.on("connection", (socket) => {
  console.log(`🟢 New User connected: ${socket.id}`);
  socketList[socket.id] = { video: true, audio: true };
  socket.on("disconnect", () => {
    console.log(`🔴 User disconnected: ${socket.id}`);
    delete socketList[socket.id];
  });

  socket.on("BE-check-user", async ({ roomId, userName }) => {
    let error = false;
    try {
      const clients = await io.in(roomId).allSockets();
      clients.forEach((client) => {
        if (socketList[client].userName === userName) {
          error = true;
        }
      });
      socket.emit("FE-error-user-exist", { error });
    } catch (err) {
      console.error("Error checking user:", err);
    }
  });

  /**
   * Join Room
   */
  socket.on("BE-join-room", async ({ roomId, userName }) => {
    socket.join(roomId);
    socketList[socket.id] = { userName, video: true, audio: true };

    try {
      const clients = await io.in(roomId).allSockets();
      const users = [...clients].map((client) => ({
        userId: client,
        info: socketList[client],
      }));

      socket.broadcast.to(roomId).emit("FE-user-join", users);
    } catch (err) {
      console.error("Error joining room:", err);
      socket.emit("FE-error-user-exist", { err: true });
    }
  });

  socket.on("BE-call-user", ({ userToCall, from, signal }) => {
    io.to(userToCall).emit("FE-receive-call", {
      signal,
      from,
      info: socketList[socket.id],
    });
  });

  socket.on("BE-accept-call", ({ signal, to }) => {
    io.to(to).emit("FE-call-accepted", {
      signal,
      answerId: socket.id,
    });
  });

  socket.on("BE-send-message", ({ roomId, msg, sender }) => {
    io.in(roomId).emit("FE-receive-message", { msg, sender });
  });

  socket.on("BE-leave-room", ({ roomId, leaver }) => {
    delete socketList[socket.id];

    socket.broadcast.to(roomId).emit("FE-user-leave", {
      userId: socket.id,
      userName: leaver,
    });

    // ✅ Properly remove user from room
    socket.leave(roomId);
  });

  socket.on("BE-toggle-camera-audio", ({ roomId, switchTarget }) => {
    if (switchTarget === "video") {
      socketList[socket.id].video = !socketList[socket.id].video;
    } else {
      socketList[socket.id].audio = !socketList[socket.id].audio;
    }
    socket.broadcast
      .to(roomId)
      .emit("FE-toggle-camera", { userId: socket.id, switchTarget });
  });
});

// ✅ Start the server properly
http.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on:`);
  console.log(`👉 Local: http://localhost:${PORT}`);
  console.log(`👉 Network: http://${localIP}:${PORT}`);
});
