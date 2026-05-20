const http = require('http');
const { Server } = require('socket.io');

const PORT = 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Quiz Night Server läuft!');
});

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const rooms = {}; // code -> { code, game, players, quizData, started }

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms[code] ? generateCode() : code;
}

io.on('connection', (socket) => {
  console.log('Verbunden:', socket.id);

  socket.on('create_room', ({ game, playerName, quizData }) => {
    const code = generateCode();
    const room = {
      code,
      game,
      quizData: quizData || null,
      started: false,
      players: [{ name: playerName, isHost: true, socketId: socket.id, score: 0 }]
    };
    rooms[code] = room;
    socket.join(code);
    socket.data.code = code;
    socket.data.name = playerName;
    console.log(`Raum erstellt: ${code} (${game}) von ${playerName}`);
    socket.emit('room_created', { code, room: sanitizeRoom(room) });
  });

  socket.on('join_room', ({ code, playerName }) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('error', { msg: 'Raum nicht gefunden!' });
      return;
    }
    if (room.started) {
      // Reconnect-Versuch
      const existing = room.players.find(p => p.name === playerName);
      if (existing) {
        existing.socketId = socket.id;
        socket.join(code);
        socket.data.code = code;
        socket.data.name = playerName;
        socket.emit('room_joined', { room: sanitizeRoom(room), yourName: playerName, code, gameState: null });
        return;
      }
      socket.emit('error', { msg: 'Spiel bereits gestartet!' });
      return;
    }
    if (room.players.find(p => p.name === playerName)) {
      socket.emit('error', { msg: 'Name bereits vergeben!' });
      return;
    }
    room.players.push({ name: playerName, isHost: false, socketId: socket.id, score: 0 });
    socket.join(code);
    socket.data.code = code;
    socket.data.name = playerName;
    console.log(`${playerName} ist Raum ${code} beigetreten`);
    socket.emit('room_joined', { room: sanitizeRoom(room), yourName: playerName, code });
    io.to(code).emit('player_joined', { room: sanitizeRoom(room) });
  });

  socket.on('start_game', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.started = true;
    console.log(`Spiel gestartet: ${code}`);
    io.to(code).emit('game_started', { room: sanitizeRoom(room), quizData: room.quizData });
  });

  socket.on('game_action', ({ code, action, payload }) => {
    const room = rooms[code];
    if (!room) return;
    // Alle anderen im Raum erhalten die Aktion
    socket.to(code).emit('game_action', { action, payload });

    // Bei kick_player aus dem Raum entfernen
    if (action === 'kick_player' && payload?.name) {
      const kicked = room.players.find(p => p.name === payload.name);
      if (kicked) {
        room.players = room.players.filter(p => p.name !== payload.name);
        const kickedSocket = io.sockets.sockets.get(kicked.socketId);
        if (kickedSocket) {
          kickedSocket.leave(code);
          kickedSocket.emit('game_action', { action: 'kicked', payload: {} });
        }
        io.to(code).emit('room_update', { room: sanitizeRoom(room) });
      }
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.code;
    const name = socket.data.name;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    room.players = room.players.filter(p => p.socketId !== socket.id);
    console.log(`${name} hat Raum ${code} verlassen`);
    if (room.players.length === 0) {
      delete rooms[code];
      console.log(`Raum ${code} gelöscht`);
    } else {
      io.to(code).emit('player_left', { room: sanitizeRoom(room) });
    }
  });
});

function sanitizeRoom(room) {
  return {
    code: room.code,
    game: room.game,
    started: room.started,
    players: room.players.map(p => ({ name: p.name, isHost: p.isHost, score: p.score }))
  };
}

server.listen(PORT, () => {
  console.log(`✅ Server läuft auf http://localhost:${PORT}`);
});
