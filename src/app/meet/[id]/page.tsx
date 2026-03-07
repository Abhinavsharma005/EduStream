
"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Video, VideoOff, MonitorUp, LogOut, Loader2, Users, MessageSquare, BarChart2, HelpCircle, Paperclip, Smile, Send, ChevronDown } from "lucide-react";
import { PollView } from "@/components/meet/PollView";
import { QuizView } from "@/components/meet/QuizView";
import { cn } from "@/lib/utils";
import EmojiPicker, { Theme } from 'emoji-picker-react';

import {
    LiveKitRoom,
    RoomAudioRenderer,
    useLocalParticipant,
    useTracks,
    ParticipantTile,
    useConnectionState,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track } from "livekit-client";

interface Message {
    sender: string;
    text: string;
    time: string;
    isSelf: boolean;
    fileUrl?: string;
    fileName?: string;
    fileType?: string;
}

export default function MeetPage() {
    const { id: rawRoomId } = useParams();
    const roomId = Array.isArray(rawRoomId) ? rawRoomId[0] : rawRoomId;
    const router = useRouter();

    // Chat State

    // ... State ... (Partial replacement would be tricky, replacing component body or large chunk)
    // I will replace the component logic carefully.

    // ... inside MeetPage ...
    const [activeTab, setActiveTab] = useState<"chat" | "poll" | "quiz">("chat");
    const [polls, setPolls] = useState<any[]>([]); // Define Type properly ideally
    const [quizzes, setQuizzes] = useState<any[]>([]);

    // Unread counts (red dots)
    const [unread, setUnread] = useState({ chat: 0, poll: 0, quiz: 0 });

    const [socket, setSocket] = useState<Socket | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputMsg, setInputMsg] = useState("");
    const [participantCount, setParticipantCount] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const [reactions, setReactions] = useState<{ id: string; emoji: string; x: number; isSelf: boolean; senderName?: string }[]>([]);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [selectedFile, setSelectedFile] = useState<{ name: string, type: string, url: string } | null>(null);
    const [showScrollBottom, setShowScrollBottom] = useState(false);

    // LiveKit State
    const [token, setToken] = useState("");
    const [serverUrl, setServerUrl] = useState(process.env.NEXT_PUBLIC_LIVEKIT_URL || "");

    const [user, setUser] = useState<{ id: string, name: string, role: string, profile?: string } | null>(null);
    const [teacherInfo, setTeacherInfo] = useState<{ name: string, profile?: string } | null>(null);

    useEffect(() => {
        // 1. Fetch User Identity
        fetch("/api/auth/me")
            .then(res => res.json())
            .then(userData => {
                if (userData.user) {
                    setUser({ id: userData.user._id, name: userData.user.name, role: userData.user.role, profile: userData.user.profile });

                    // 2. Session check 
                    fetch(`/api/sessions/${roomId}`)
                        .then(res => res.json())
                        .then(sessionData => {
                            if (sessionData.session) {
                                // Set Teacher Info for Students
                                if (sessionData.session.hostId) {
                                    setTeacherInfo({
                                        name: sessionData.session.hostId.name,
                                        profile: sessionData.session.hostId.profile
                                    });
                                }

                                // 3. Get LiveKit Token
                                fetch(`/api/livekit/get-token?room=${roomId}&username=${userData.user.name}&role=${userData.user.role}`)
                                    .then(res => res.json())
                                    .then(data => {
                                        setToken(data.token);
                                        if (data.serverUrl) setServerUrl(data.serverUrl);
                                    });

                                // 4. Connect Chat Socket
                                connectSocket(userData.user._id, userData.user.name, roomId as string);
                            }
                        });
                } else {
                    router.push("/authpage?mode=login");
                }
            })
            .catch(() => router.push("/authpage?mode=login"));

        return () => {
            if (socket) socket.disconnect();
        };
    }, [roomId, router]);

    const connectSocket = (userId: string, userName: string, rId: string) => {
        const newSocket = io({
            path: "/socket.io",
        });

        setSocket(newSocket);
        newSocket.emit("join-room", rId, userId);

        newSocket.on("update-participant-count", (count: number) => {
            setParticipantCount(count);
        });

        // --- Poll & Quiz Listeners ---
        newSocket.on("sync-room-state", (data: { polls: any[], quizzes: any[] }) => {
            setPolls(data.polls || []);
            setQuizzes(data.quizzes || []);
        });

        newSocket.on("new-poll", (poll: any) => {
            setPolls(prev => [...prev, poll]);
            if (activeTab !== "poll") setUnread(prev => ({ ...prev, poll: prev.poll + 1 }));
        });

        newSocket.on("update-poll-results", (data: { poll: any }) => {
            setPolls(prev => prev.map(p => p.id === data.poll.id ? data.poll : p));
        });

        newSocket.on("new-quiz", (quiz: any) => {
            setQuizzes(prev => [...prev, quiz]);
            if (activeTab !== "quiz") setUnread(prev => ({ ...prev, quiz: prev.quiz + 1 }));
        });

        newSocket.on("update-quiz-results", (data: { quizId: string, answers: any }) => {
            setQuizzes(prev => prev.map(q => q.id === data.quizId ? { ...q, answers: data.answers } : q));

        });

        newSocket.on("new-message", (data: any) => {
            setMessages((prev) => [...prev, {
                sender: data.sender || "Unknown",
                text: data.message,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isSelf: data.senderId === userId,
                fileUrl: data.fileUrl,
                fileName: data.fileName,
                fileType: data.fileType
            }]);
            if (activeTab !== "chat") setUnread(prev => ({ ...prev, chat: prev.chat + 1 }));
            scrollToBottom();
        });

        newSocket.on("new-reaction", (data: any) => {
            if (data.senderId !== userId) {
                const id = Math.random().toString(36).substr(2, 9);
                setReactions(prev => [...prev, {
                    id,
                    emoji: data.emoji,
                    x: Math.floor(Math.random() * 80) + 10,
                    isSelf: false,
                    senderName: data.senderName
                }]);
                setTimeout(() => {
                    setReactions(prev => prev.filter(r => r.id !== id));
                }, 3000);
            }
        });
    };

    const triggerReaction = (emj: string) => {
        const id = Math.random().toString(36).substr(2, 9);
        setReactions(prev => [...prev, { id, emoji: emj, x: Math.floor(Math.random() * 80) + 10, isSelf: true, senderName: user?.name }]);
        if (socket && user) {
            socket.emit("send-reaction", { roomId, emoji: emj, senderId: user.id, senderName: user.name });
        }
        setTimeout(() => {
            setReactions(prev => prev.filter(r => r.id !== id));
        }, 3000);
    };

    const sendMessage = () => {
        if ((!inputMsg.trim() && !selectedFile) || !socket || !user) return;
        socket.emit("send-message", {
            roomId,
            message: inputMsg,
            sender: user.name,
            senderId: user.id,
            fileUrl: selectedFile?.url,
            fileName: selectedFile?.name,
            fileType: selectedFile?.type
        });
        setInputMsg("");
        setSelectedFile(null);
    };

    const scrollToBottom = () => {
        setTimeout(() => {
            if (chatContainerRef.current) {
                chatContainerRef.current.scrollTo({
                    top: chatContainerRef.current.scrollHeight,
                    behavior: 'smooth'
                });
            }
        }, 100);
    };

    const handleChatScroll = () => {
        if (!chatContainerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
        // Show button if we are scrolled up more than 100px from the bottom
        if (scrollHeight - scrollTop - clientHeight > 100) {
            setShowScrollBottom(true);
        } else {
            setShowScrollBottom(false);
        }
    };

    const endSession = async () => {
        if (confirm("Are you sure you want to end this session for everyone? Passcode: END")) {
            try {
                await fetch(`/api/sessions/${roomId}/end`, { method: "POST" });
                // Disconnect socket/livekit if needed, but router push is usually enough
                if (socket) socket.disconnect();
                router.push("/dashboard/teacher");
            } catch (e) {
                console.error("Failed to end session", e);
                alert("Failed to end session");
            }
        }
    };

    const leaveSession = () => {
        if (user?.role === "teacher") router.push("/dashboard/teacher");
        else router.push("/dashboard/student");
    };

    if (!user || !token || !serverUrl) return <div className="flex h-screen items-center justify-center text-white bg-black">Loading Session...</div>;

    const isTeacher = user.role === "teacher";

    return (
        <div className="flex h-screen bg-black text-white overflow-hidden">
            <LiveKitRoom
                video={isTeacher}
                audio={isTeacher}
                token={token}
                serverUrl={serverUrl}
                data-lk-theme="default"
                className="flex-1 flex flex-col relative"
                onDisconnected={leaveSession}
            >
                <div className="flex-1 flex flex-col relative">
                    {/* Main Video Area */}
                    <div className="flex-1 relative bg-gray-900 flex items-center justify-center p-4">
                        <VideoLayout
                            isTeacher={isTeacher}
                            teacherProfile={isTeacher ? user?.profile : teacherInfo?.profile}
                            teacherName={isTeacher ? user?.name || "Teacher" : teacherInfo?.name || "Teacher"}
                        />
                        <RoomAudioRenderer />

                        {/* Connection Status Badge */}
                        <div className="absolute top-4 left-4 bg-black/50 px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2 z-50 backdrop-blur-sm border border-white/10">
                            <ConnectionStatusIndicator />
                        </div>
                    </div>

                    {/* Custom Controls */}
                    <CustomControlBar isTeacher={isTeacher} onLeave={leaveSession} onEndSession={endSession} />
                </div>
            </LiveKitRoom>

            {/* Sidebar Tabs */}
            <div className="w-80 bg-gray-950 border-l border-gray-800 flex flex-col z-50 transition-all duration-300">
                {/* Tab Headers */}
                <div className="flex border-b border-gray-800 bg-gray-900/50">
                    <button
                        onClick={() => { setActiveTab("chat"); setUnread(p => ({ ...p, chat: 0 })); }}
                        className={`flex-1 p-3 flex justify-center items-center relative transition-colors ${activeTab === "chat" ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-500/5' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'}`}
                    >
                        <MessageSquare className="h-5 w-5" />
                        {unread.chat > 0 && <span className="absolute top-2 right-6 h-2 w-2 rounded-full bg-red-500 animate-pulse ring-2 ring-gray-900" />}
                    </button>
                    <button
                        onClick={() => { setActiveTab("quiz"); setUnread(p => ({ ...p, quiz: 0 })); }}
                        className={`flex-1 p-3 flex justify-center items-center relative transition-colors ${activeTab === "quiz" ? 'text-purple-400 border-b-2 border-purple-500 bg-purple-500/5' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'}`}
                    >
                        <HelpCircle className="h-5 w-5" />
                        {unread.quiz > 0 && <span className="absolute top-2 right-6 h-2 w-2 rounded-full bg-red-500 animate-pulse ring-2 ring-gray-900" />}
                    </button>
                    <button
                        onClick={() => { setActiveTab("poll"); setUnread(p => ({ ...p, poll: 0 })); }}
                        className={`flex-1 p-3 flex justify-center items-center relative transition-colors ${activeTab === "poll" ? 'text-green-400 border-b-2 border-green-500 bg-green-500/5' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'}`}
                    >
                        <BarChart2 className="h-5 w-5" />
                        {unread.poll > 0 && <span className="absolute top-2 right-6 h-2 w-2 rounded-full bg-red-500 animate-pulse ring-2 ring-gray-900" />}
                    </button>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-hidden relative">
                    {/* Chat View */}
                    <div className={cn("absolute inset-0 flex flex-col transition-transform duration-300", activeTab === "chat" ? "translate-x-0" : activeTab === "quiz" ? "-translate-x-full" : "-translate-x-full")}>
                        <style>{`
                            @keyframes floatUp {
                                0% { opacity: 0; transform: translateY(20px) scale(0.5); }
                                15% { opacity: 1; transform: translateY(0px) scale(1.2); }
                                80% { opacity: 0.8; transform: translateY(-80px) scale(1.1); }
                                100% { opacity: 0; transform: translateY(-120px) scale(0.9); }
                            }
                            .dark-scrollbar::-webkit-scrollbar {
                                width: 6px;
                            }
                            .dark-scrollbar::-webkit-scrollbar-track {
                                background: #0f172a; /* slate-900 */
                                border-radius: 8px;
                            }
                            .dark-scrollbar::-webkit-scrollbar-thumb {
                                background: #334155; /* slate-700 */
                                border-radius: 8px;
                            }
                            .dark-scrollbar::-webkit-scrollbar-thumb:hover {
                                background: #475569; /* slate-600 */
                            }
                        `}</style>
                        <div className="p-3 border-b border-gray-800 flex justify-between items-center bg-gray-900/30">
                            <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-xs tracking-wide uppercase text-gray-400">Live Chat</h3>
                                <div className="flex items-center gap-1.5 ml-2 bg-gray-800 px-2 py-0.5 rounded-full text-[10px] text-gray-400 border border-gray-700">
                                    <Users className="h-3 w-3" />
                                    <span>{participantCount}</span>
                                </div>
                            </div>
                        </div>

                        <div
                            ref={chatContainerRef}
                            onScroll={handleChatScroll}
                            className="flex-1 overflow-y-auto p-4 space-y-4 relative dark-scrollbar"
                        >
                            {/* Floating Reactions overlay */}
                            <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-50 h-full overflow-hidden">
                                {reactions.map(r => (
                                    <div key={r.id} className="absolute flex flex-col items-center justify-center bottom-2"
                                        style={{ left: `${r.x}%`, animation: 'floatUp 3s ease-out forwards' }}>
                                        <span className={cn(
                                            "drop-shadow-lg",
                                            r.emoji === 'YES' ? "text-2xl text-emerald-400 font-bold" :
                                                r.emoji === 'NO' ? "text-2xl text-rose-400 font-bold" :
                                                    "text-3xl"
                                        )}>{r.emoji}</span>
                                        {r.senderName && <span className="text-[10px] text-white/80 bg-black/50 px-1.5 py-0.5 rounded-full mt-1 whitespace-nowrap">{r.senderName}</span>}
                                    </div>
                                ))}
                            </div>

                            {messages.length === 0 && <div className="flex flex-col items-center justify-center h-full text-gray-600 text-sm gap-2 opacity-50">
                                <MessageSquare className="h-8 w-8" />
                                <p>No messages yet</p>
                            </div>}
                            {messages.map((msg, idx) => (
                                <div key={idx} className={`flex flex-col ${msg.isSelf ? 'items-end' : 'items-start'} animate-in slide-in-from-bottom-2 duration-300`}>
                                    <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-sm ${msg.isSelf ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-800 text-gray-200 rounded-bl-none'}`}>
                                        {!msg.isSelf && <p className="text-[10px] font-bold mb-1 opacity-70 uppercase tracking-wider text-blue-300">{msg.sender}</p>}
                                        {msg.fileUrl && (
                                            <div className="mb-2">
                                                {msg.fileType?.startsWith('image/') ? (
                                                    <img src={msg.fileUrl} alt="attachment" className="max-w-full max-h-[150px] rounded object-contain border border-white/20" />
                                                ) : (
                                                    <a href={msg.fileUrl} download={msg.fileName} className={`flex items-center gap-2 p-2 rounded border ${msg.isSelf ? 'bg-blue-700/50 border-blue-500/50 hover:bg-blue-700' : 'bg-gray-900 border-gray-700 hover:bg-gray-800'} transition-colors inline-flex`}>
                                                        <Paperclip className="h-4 w-4 shrink-0" />
                                                        <span className="text-xs truncate max-w-[150px]">{msg.fileName}</span>
                                                    </a>
                                                )}
                                            </div>
                                        )}
                                        {msg.text && <p className="leading-snug">{msg.text}</p>}
                                    </div>
                                    <span className="text-[10px] text-gray-500 mt-1 px-1">{msg.time}</span>
                                </div>
                            ))}

                            {showScrollBottom && (
                                <button
                                    onClick={scrollToBottom}
                                    className="sticky bottom-2 left-1/2 -translate-x-1/2 bg-gray-800/90 hover:bg-gray-700 text-white p-1.5 rounded-full shadow-lg border border-gray-700 transition-all z-40 backdrop-blur"
                                >
                                    <ChevronDown className="h-5 w-5" />
                                </button>
                            )}
                        </div>

                        <div className="p-3 border-t border-gray-800 bg-gray-900/50 relative">
                            {/* Floating Reaction Bar */}
                            <div className="px-2 pb-3 pt-1 flex items-center justify-between opacity-90 transition-opacity">
                                <button onClick={() => triggerReaction('YES')} className="text-emerald-400 font-bold hover:scale-110 transition-transform tracking-wider focus:outline-none text-sm">YES</button>
                                <button onClick={() => triggerReaction('NO')} className="text-rose-400 font-bold hover:scale-110 transition-transform tracking-wider focus:outline-none text-sm">NO</button>
                                <button onClick={() => triggerReaction('😂')} className="text-lg hover:scale-110 transition-transform focus:outline-none">😂</button>
                                <button onClick={() => triggerReaction('🎉')} className="text-lg hover:scale-110 transition-transform focus:outline-none">🎉</button>
                                <button onClick={() => triggerReaction('👏')} className="text-lg hover:scale-110 transition-transform focus:outline-none">👏</button>
                                <button onClick={() => triggerReaction('👍')} className="text-lg hover:scale-110 transition-transform focus:outline-none">👍</button>
                            </div>

                            <div className="relative bg-[#1A1C23] border border-gray-700 rounded-xl p-2 flex flex-col focus-within:border-gray-500 transition-colors">
                                {selectedFile && (
                                    <div className="flex items-center gap-2 p-1.5 bg-gray-800/80 rounded mb-2 border border-gray-700 relative w-max max-w-[90%]">
                                        {selectedFile.type.startsWith('image/') ? (
                                            <img src={selectedFile.url} alt="preview" className="h-8 w-8 object-cover rounded" />
                                        ) : (
                                            <div className="h-8 w-8 bg-gray-700 flex items-center justify-center rounded">
                                                <Paperclip className="h-4 w-4 text-gray-400" />
                                            </div>
                                        )}
                                        <div className="text-xs text-gray-300 truncate max-w-[120px]">{selectedFile.name}</div>
                                        <button onClick={() => setSelectedFile(null)} className="absolute -top-1.5 -right-1.5 bg-red-500 rounded-full p-0.5 text-white hover:bg-red-600 focus:outline-none z-10">
                                            <svg width="10" height="10" viewBox="0 0 15 15" fill="none"><path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.557 2.99385 11.193 2.99385 10.9684 3.2184L7.50005 6.68673L4.03164 3.21832C3.80708 2.99376 3.44301 2.99376 3.21846 3.21832C2.9939 3.44287 2.9939 3.80694 3.21846 4.0315L6.68687 7.49991L3.21846 10.9683C2.9939 11.1929 2.9939 11.557 3.21846 11.7815C3.44301 12.0061 3.80708 12.0061 4.03164 11.7815L7.50005 8.3131L10.9684 11.7815C11.193 12.0061 11.557 12.0061 11.7816 11.7815C12.0062 11.557 12.0062 11.1929 11.7816 10.9683L8.31322 7.49991L11.7816 4.03157Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
                                        </button>
                                    </div>
                                )}
                                <textarea
                                    value={inputMsg}
                                    onChange={e => setInputMsg(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            sendMessage();
                                        }
                                    }}
                                    placeholder="Message.."
                                    className="w-full bg-transparent text-white placeholder:text-gray-400 resize-none outline-none text-sm px-1 min-h-[55px]"
                                />
                                <div className="flex justify-between items-end mt-1 px-1">
                                    <div className="flex gap-4 text-gray-400 mb-1">
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    const reader = new FileReader();
                                                    reader.onload = (evt) => {
                                                        setSelectedFile({
                                                            name: file.name,
                                                            type: file.type,
                                                            url: evt.target?.result as string
                                                        });
                                                    };
                                                    reader.readAsDataURL(file);
                                                }
                                                // reset the input so same file can be selected again if removed
                                                e.target.value = '';
                                            }}
                                        />
                                        <button onClick={() => fileInputRef.current?.click()} className="hover:text-white transition-colors focus:outline-none">
                                            <Paperclip className="h-[18px] w-[18px]" />
                                        </button>

                                        <div className="relative">
                                            <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="hover:text-white transition-colors focus:outline-none">
                                                <Smile className="h-[18px] w-[18px]" />
                                            </button>
                                        </div>
                                    </div>
                                    <Button onClick={sendMessage} size="icon" className="h-8 w-8 rounded bg-blue-600 hover:bg-blue-500 transition-all flex-shrink-0">
                                        <Send className="h-[15px] w-[15px] ml-0.5" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Quiz View */}
                    <div className={cn("absolute inset-0 transition-transform duration-300 bg-gray-950", activeTab === "quiz" ? "translate-x-0" : activeTab === "chat" ? "translate-x-full" : "-translate-x-full")}>
                        <QuizView
                            quizzes={quizzes}
                            isTeacher={isTeacher}
                            onCreateQuiz={(q, o, c) => socket?.emit("create-quiz", { roomId, question: q, options: o, correctIndex: c })}
                            onAnswer={(qid, oid) => socket?.emit("answer-quiz", { roomId, quizId: qid, optionIndex: oid, studentName: user?.name })}
                        />
                    </div>

                    {/* Poll View */}
                    <div className={cn("absolute inset-0 transition-transform duration-300 bg-gray-950", activeTab === "poll" ? "translate-x-0" : "translate-x-full")}>
                        <PollView
                            polls={polls}
                            isTeacher={isTeacher}
                            onCreatePoll={(q, o) => socket?.emit("create-poll", { roomId, question: q, options: o })}
                            onVote={(pid, oid) => socket?.emit("vote-poll", { roomId, pollId: pid, optionIndex: oid })}
                        />
                    </div>
                </div>
            </div>

            {/* Global Overlays */}
            {showEmojiPicker && (
                <div className="fixed bottom-24 right-6 z-[9999] shadow-2xl drop-shadow-2xl">
                    <EmojiPicker
                        theme={Theme.DARK}
                        onEmojiClick={(emojiData: any) => {
                            setInputMsg(p => p + emojiData.emoji);
                            setShowEmojiPicker(false);
                        }}
                        width={320}
                        height={400}
                    />
                </div>
            )}
        </div>
    );
}

import { UserAvatar } from "@/components/UserAvatar";

function VideoLayout({ isTeacher, teacherProfile, teacherName }: { isTeacher: boolean, teacherProfile?: string, teacherName: string }) {

    const tracks = useTracks(
        [Track.Source.Camera, Track.Source.ScreenShare],
        { onlySubscribed: false }
    );


    const videoTrack = tracks.find(t => t.source === Track.Source.ScreenShare) ||
        tracks.find(t => t.source === Track.Source.Camera);

    return (
        <div className="w-full h-full flex items-center justify-center">
            {videoTrack ? (
                <div className="w-full max-w-5xl aspect-video rounded-xl overflow-hidden shadow-2xl border border-gray-800 bg-black relative group">
                    <ParticipantTile
                        trackRef={videoTrack}
                        className="w-full h-full object-cover"
                        disableSpeakingIndicator={true}
                    />
                    {/* Overlay Name */}
                    <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur px-3 py-1 rounded text-sm font-medium text-white/90">
                        {videoTrack.participant.name || videoTrack.participant.identity}
                        {videoTrack.source === Track.Source.ScreenShare && " (Screen)"}
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center text-gray-500 gap-4">
                    <div className="h-32 w-32 rounded-full border-4 border-gray-800 p-1">
                        <UserAvatar name={teacherName} image={teacherProfile} className="h-full w-full rounded-full text-4xl" />
                    </div>
                    <p className="text-gray-600 font-medium">
                        {isTeacher ? "Your camera is off" : "Instructor's camera is off"}
                    </p>
                </div>
            )}
        </div>
    );
}

function ConnectionStatusIndicator() {
    const connectionState = useConnectionState();

    if (connectionState === "connected") {
        return <><span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /> LIVE</>;
    } else if (connectionState === "connecting" || connectionState === "reconnecting") {
        return <><Loader2 className="h-3 w-3 animate-spin text-yellow-500" /> Connecting...</>;
    } else {
        return <><span className="h-2 w-2 rounded-full bg-gray-500" /> {connectionState}</>;
    }
}

function CustomControlBar({ isTeacher, onLeave, onEndSession }: { isTeacher: boolean, onLeave: () => void, onEndSession?: () => void }) {
    const { localParticipant } = useLocalParticipant();

    const [micOn, setMicOn] = useState(false);
    const [camOn, setCamOn] = useState(false);
    const [screenOn, setScreenOn] = useState(false);

    useEffect(() => {
        if (!localParticipant) return;

        // Sync initial state
        setMicOn(localParticipant.isMicrophoneEnabled);
        setCamOn(localParticipant.isCameraEnabled);
        setScreenOn(localParticipant.isScreenShareEnabled);

    }, [localParticipant]);

    const toggleMic = async () => {
        if (!localParticipant) return;
        const newState = !micOn;
        try {
            await localParticipant.setMicrophoneEnabled(newState);
            setMicOn(newState);
        } catch (e) {
            console.error(e);
        }
    };

    const toggleCam = async () => {
        if (!localParticipant) return;
        const newState = !camOn;
        try {
            await localParticipant.setCameraEnabled(newState);
            setCamOn(newState);
        } catch (e) {
            console.error(e);
        }
    };

    const toggleScreen = async () => {
        if (!localParticipant) return;
        const newState = !screenOn;
        try {
            await localParticipant.setScreenShareEnabled(newState);
            setScreenOn(newState);
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="h-20 flex justify-center items-center gap-6 bg-gray-950 border-t border-gray-800">
            {isTeacher ? (
                <>
                    <Button
                        variant={micOn ? "secondary" : "destructive"}
                        size="icon"
                        onClick={toggleMic}
                        className={`rounded-full h-14 w-14 transition-all duration-200 ${micOn ? 'bg-gray-800 hover:bg-gray-700 text-white' : 'bg-red-600 hover:bg-red-700'}`}
                    >
                        {micOn ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
                    </Button>
                    <Button
                        variant={camOn ? "secondary" : "destructive"}
                        size="icon"
                        onClick={toggleCam}
                        className={`rounded-full h-14 w-14 transition-all duration-200 ${camOn ? 'bg-gray-800 hover:bg-gray-700 text-white' : 'bg-red-600 hover:bg-red-700'}`}
                    >
                        {camOn ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
                    </Button>
                    <Button
                        variant="secondary"
                        size="icon"
                        onClick={toggleScreen}
                        className={`rounded-full h-14 w-14 transition-all duration-200 ${screenOn ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white'}`}
                    >
                        <MonitorUp className="h-6 w-6" />
                    </Button>
                    <div className="w-px h-8 bg-gray-800 mx-2" />

                    {/* LEAVE BUTTON */}
                    <Button variant="ghost" className="px-6 rounded-full h-12 font-medium text-gray-300 hover:text-white hover:bg-gray-800" onClick={onLeave}>
                        <LogOut className="mr-2 h-5 w-5" /> Leave
                    </Button>

                    {/* END SESSION BUTTON */}
                    <Button variant="destructive" className="px-8 rounded-full h-12 font-medium bg-red-600 hover:bg-red-700 shadow-lg shadow-red-900/20" onClick={onEndSession}>
                        End Session
                    </Button>
                </>
            ) : (
                <div className="flex items-center gap-4">
                    <div className="text-gray-500 text-sm flex items-center gap-2 px-4 py-2 bg-gray-900 rounded-full">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                        </span>
                        Viewing as Student
                    </div>
                    <Button variant="secondary" className="px-6 rounded-full h-10 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors border border-gray-700/50" onClick={onLeave}>
                        <LogOut className="mr-2 h-4 w-4" /> Leave
                    </Button>
                </div>
            )}
        </div>
    );
}
