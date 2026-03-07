
import express from "express";
import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

// LiveKit will handle video separately via its own Cloud.
// Socket.IO is kept for Chat and custom signaling if needed (though LiveKit has chat too).

app.prepare().then(async () => {
    // Mediasoup removed.

    const server = express();
    const httpServer = createServer(server);
    const io = new Server(httpServer, {
        cors: {
            origin: "*", // Adjust in production
            methods: ["GET", "POST"]
        }
    });

    // In-memory room user tracking
    // roomId -> Map<userId, Set<socketId>>
    // This allows us to count UNIQUE users, while handling multiple tabs (sockets) per user.
    const roomUsers = new Map<string, Map<string, Set<string>>>();

    // Quick lookup for disconnect: socketId -> { roomId, userId }
    const socketUserMap = new Map<string, { roomId: string, userId: string }>();

    // In-memory Polls & Quizzes
    // Structure: roomId -> [items]
    interface Poll {
        id: string;
        question: string;
        options: { text: string, votes: number }[];
        active: boolean;
        createdAt: number;
    }

    interface Quiz {
        id: string;
        question: string;
        options: string[];
        correctOptionIndex: number; // For teacher reference (or auto grading)
        answers: Record<string, number>; // optionIndex -> count
        active: boolean;
        createdAt: number;
    }

    const roomPolls = new Map<string, Poll[]>();
    const roomQuizzes = new Map<string, Quiz[]>();

    io.on("connection", (socket) => {
        console.log("Client connected:", socket.id);

        socket.on("join-room", async (room, userId) => {
            const roomId = String(room); // Ensure string
            socket.join(roomId);
            console.log(`User ${userId} joined room ${roomId}`);

            // 1. Track Socket->User mapping
            socketUserMap.set(socket.id, { roomId, userId });

            // 2. Track Room->User->Sockets
            if (!roomUsers.has(roomId)) {
                roomUsers.set(roomId, new Map());
            }
            const roomParticipants = roomUsers.get(roomId)!;

            if (!roomParticipants.has(userId)) {
                roomParticipants.set(userId, new Set());
            }
            roomParticipants.get(userId)!.add(socket.id);

            // 3. Broadcast UNIQUE user count
            const uniqueUserCount = roomParticipants.size;
            io.to(roomId).emit("update-participant-count", uniqueUserCount);

            // Send existing active items to new joiner
            const polls = roomPolls.get(roomId) || [];
            const quizzes = roomQuizzes.get(roomId) || [];
            socket.emit("sync-room-state", { polls, quizzes });

            // Notify others
            socket.to(roomId).emit("user-joined", userId);
        });

        socket.on("send-message", (data) => {
            io.to(data.roomId).emit("new-message", data);
        });

        socket.on("send-reaction", (data) => {
            io.to(data.roomId).emit("new-reaction", data);
        });

        // --- Poll Events ---
        socket.on("create-poll", (data: { roomId: string, question: string, options: string[] }) => {
            const newPoll: Poll = {
                id: Date.now().toString(),
                question: data.question,
                options: data.options.map(opt => ({ text: opt, votes: 0 })),
                active: true,
                createdAt: Date.now()
            };

            if (!roomPolls.has(data.roomId)) roomPolls.set(data.roomId, []);
            roomPolls.get(data.roomId)?.push(newPoll);

            io.to(data.roomId).emit("new-poll", newPoll);
        });

        socket.on("vote-poll", (data: { roomId: string, pollId: string, optionIndex: number }) => {
            const polls = roomPolls.get(data.roomId);
            const poll = polls?.find(p => p.id === data.pollId);
            if (poll && poll.active && poll.options[data.optionIndex]) {
                poll.options[data.optionIndex].votes += 1;
                io.to(data.roomId).emit("update-poll-results", { poll });
            }
        });

        // --- Quiz Events ---
        socket.on("create-quiz", (data: { roomId: string, question: string, options: string[], correctIndex: number }) => {
            const newQuiz: Quiz = {
                id: Date.now().toString(),
                question: data.question,
                options: data.options,
                correctOptionIndex: data.correctIndex,
                answers: {}, // Initialize counts logic
                active: true,
                createdAt: Date.now()
            };
            // Flatten answers init
            data.options.forEach((_, idx) => newQuiz.answers[idx] = 0);

            if (!roomQuizzes.has(data.roomId)) roomQuizzes.set(data.roomId, []);
            roomQuizzes.get(data.roomId)?.push(newQuiz);

            io.to(data.roomId).emit("new-quiz", newQuiz);
        });

        socket.on("answer-quiz", (data: { roomId: string, quizId: string, optionIndex: number, studentName: string }) => {
            const quizzes = roomQuizzes.get(data.roomId);
            const quiz = quizzes?.find(q => q.id === data.quizId);
            if (quiz && quiz.active) {
                // Increment count
                quiz.answers[data.optionIndex] = (quiz.answers[data.optionIndex] || 0) + 1;

                // Notify Teacher (Students see aggregate, Teacher sees notification)
                // We broadcast update to everyone for bars
                io.to(data.roomId).emit("update-quiz-results", { quizId: quiz.id, answers: quiz.answers });

                // Send specific notification to teachers? 
                // For simplified logic, frontend handles "New Answer" badge if updated.
            }
        });

        socket.on("disconnect", async () => {
            console.log("Client disconnected:", socket.id);

            // Find who disconnected
            const info = socketUserMap.get(socket.id);
            if (info) {
                const { roomId, userId } = info;
                socketUserMap.delete(socket.id);

                const roomParticipants = roomUsers.get(roomId);
                if (roomParticipants && roomParticipants.has(userId)) {
                    const userSockets = roomParticipants.get(userId)!;
                    userSockets.delete(socket.id);

                    // If user has no more open sockets, they are gone
                    if (userSockets.size === 0) {
                        roomParticipants.delete(userId);

                        // Update everyone else's count
                        io.to(roomId).emit("update-participant-count", roomParticipants.size);
                    }
                    // Else: User still has another tab open, do not decrease count
                }

                // Clean up empty room
                if (roomParticipants && roomParticipants.size === 0) {
                    roomUsers.delete(roomId);
                    // Optional: Cleanup data after delay?
                    // roomPolls.delete(roomId);
                    // roomQuizzes.delete(roomId);
                }
            }
        });
    });

    server.all(/.*/, (req, res) => {
        return handle(req, res);
    });

    const PORT = process.env.PORT || 3000;
    httpServer.listen(PORT, () => {
        console.log(`> Ready on http://localhost:${PORT}`);
    });
});
