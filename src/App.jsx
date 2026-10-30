import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';

// Firebase Setup
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Game Constants & Logic ---
const ROWS = 4;
const COLS = 3;

const PIECES = {
  lion: { emoji: '🦁', name: 'Lion' },
  giraffe: { emoji: '🦒', name: 'Giraffe' },
  elephant: { emoji: '🐘', name: 'Elephant' },
  chick: { emoji: '🐥', name: 'Chick' },
  hen: { emoji: '🐔', name: 'Hen' }
};

const getInitialBoard = () => {
  const board = Array(12).fill(null);
  // P2 (Top)
  board[0] = { owner: 'P2', type: 'giraffe' };
  board[1] = { owner: 'P2', type: 'lion' };
  board[2] = { owner: 'P2', type: 'elephant' };
  board[4] = { owner: 'P2', type: 'chick' };
  // P1 (Bottom)
  board[7] = { owner: 'P1', type: 'chick' };
  board[9] = { owner: 'P1', type: 'elephant' };
  board[10] = { owner: 'P1', type: 'lion' };
  board[11] = { owner: 'P1', type: 'giraffe' };
  return board;
};

const getPieceMoves = (type, owner) => {
  switch (type) {
    case 'lion':
      return [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    case 'giraffe':
      return [[0, -1], [0, 1], [-1, 0], [1, 0]];
    case 'elephant':
      return [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    case 'chick':
      return owner === 'P1' ? [[0, -1]] : [[0, 1]];
    case 'hen':
      // Hen moves like a Gold General in Shogi
      return owner === 'P1'
        ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [0, 1]] // P1: Front, Front-Diagonals, Sides, Back
        : [[-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0], [0, -1]];  // P2: Front(down), Front-Diagonals(down), Sides, Back(up)
    default:
      return [];
  }
};

const isValidCoord = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;

export default function DoubutsuShogi() {
  const [user, setUser] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [playerRole, setPlayerRole] = useState(null); // 'P1' or 'P2'
  const [joinRoomId, setJoinRoomId] = useState('');
  const [lobbyError, setLobbyError] = useState('');

  const [gameState, setGameState] = useState({
    board: getInitialBoard(),
    turn: 'P1',
    hands: { P1: [], P2: [] },
    winner: null,
    players: { P1: null, P2: null },
    status: 'waiting'
  });

  const [selected, setSelected] = useState(null);
  const [validDestinations, setValidDestinations] = useState([]);

  // 1. Firebase Auth Setup
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Firebase Room Sync
  useEffect(() => {
    if (!user || !roomId) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomId);
    const unsubscribe = onSnapshot(roomRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setGameState(data);
        // Turn changed by opponent, clear selection
        if (data.turn !== playerRole) {
          setSelected(null);
          setValidDestinations([]);
        }
      }
    }, (err) => console.error("Room sync error:", err));
    return () => unsubscribe();
  }, [user, roomId, playerRole]);

  // --- Lobby Functions ---
  const generateRoomId = () => Math.random().toString(36).substring(2, 6).toUpperCase();

  const handleCreateRoom = async () => {
    if (!user) return;
    setLobbyError('');
    const newRoomId = generateRoomId();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', newRoomId);
    
    await setDoc(roomRef, {
      board: getInitialBoard(),
      turn: 'P1',
      hands: { P1: [], P2: [] },
      players: { P1: user.uid, P2: null },
      status: 'waiting',
      winner: null
    });
    
    setRoomId(newRoomId);
    setPlayerRole('P1');
  };

  const handleJoinRoom = async () => {
    if (!user || !joinRoomId.trim()) return;
    setLobbyError('');
    const code = joinRoomId.trim().toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', code);
    
    try {
      const snap = await getDoc(roomRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data.players.P1 === user.uid) {
          setRoomId(code);
          setPlayerRole('P1');
        } else if (data.players.P2 === user.uid) {
          setRoomId(code);
          setPlayerRole('P2');
        } else if (!data.players.P2) {
          await updateDoc(roomRef, {
            'players.P2': user.uid,
            status: 'playing'
          });
          setRoomId(code);
          setPlayerRole('P2');
        } else {
          setLobbyError('Room is full!');
        }
      } else {
        setLobbyError('Room not found!');
      }
    } catch (err) {
      setLobbyError('Error joining room.');
      console.error(err);
    }
  };

  const leaveRoom = () => {
    setRoomId(null);
    setPlayerRole(null);
    setSelected(null);
    setValidDestinations([]);
  };

  // --- Game Logic ---
  const calculateValidMoves = (currentIndex) => {
    const piece = gameState.board[currentIndex];
    if (!piece || piece.owner !== gameState.turn) return [];

    const x = currentIndex % COLS;
    const y = Math.floor(currentIndex / COLS);
    const moves = getPieceMoves(piece.type, piece.owner);
    const valid = [];

    moves.forEach(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      if (isValidCoord(nx, ny)) {
        const targetIndex = ny * COLS + nx;
        const targetPiece = gameState.board[targetIndex];
        if (!targetPiece || targetPiece.owner !== piece.owner) {
          valid.push(targetIndex);
        }
      }
    });
    return valid;
  };

  const calculateValidDrops = (pieceType, player) => {
    const valid = [];
    gameState.board.forEach((cell, index) => {
      if (cell === null) {
        const y = Math.floor(index / COLS);
        if (pieceType === 'chick') {
          if (player === 'P1' && y === 0) return;
          if (player === 'P2' && y === ROWS - 1) return;
        }
        valid.push(index);
      }
    });
    return valid;
  };

  const handleSquareClick = (index) => {
    if (gameState.winner || gameState.status !== 'playing' || playerRole !== gameState.turn) return;

    if (gameState.board[index] && gameState.board[index].owner === gameState.turn) {
      setSelected({ origin: 'board', index });
      setValidDestinations(calculateValidMoves(index));
      return;
    }

    if (selected && validDestinations.includes(index)) {
      if (selected.origin === 'board') {
        executeMove(selected.index, index);
      } else if (selected.origin === 'hand') {
        executeDrop(selected.player, selected.type, selected.handIndex, index);
      }
    } else {
      setSelected(null);
      setValidDestinations([]);
    }
  };

  const handleHandClick = (player, type, handIndex) => {
    if (gameState.winner || gameState.status !== 'playing' || player !== gameState.turn || playerRole !== gameState.turn) return;
    
    setSelected({ origin: 'hand', player, type, handIndex });
    setValidDestinations(calculateValidDrops(type, player));
  };

  const executeMove = async (fromIndex, toIndex) => {
    if (!user || !roomId) return;
    const newBoard = [...gameState.board];
    const newHands = { ...gameState.hands };
    const movingPiece = { ...newBoard[fromIndex] };
    const targetPiece = newBoard[toIndex];
    let newWinner = gameState.winner;

    if (targetPiece) {
      if (targetPiece.type === 'lion') {
        newWinner = gameState.turn;
      }
      const capturedType = targetPiece.type === 'hen' ? 'chick' : targetPiece.type;
      newHands[gameState.turn] = [...newHands[gameState.turn], capturedType];
    }

    newBoard[fromIndex] = null;
    newBoard[toIndex] = movingPiece;

    const y = Math.floor(toIndex / COLS);
    if (movingPiece.type === 'chick') {
      if ((gameState.turn === 'P1' && y === 0) || (gameState.turn === 'P2' && y === ROWS - 1)) {
        newBoard[toIndex].type = 'hen';
      }
    }

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomId);
    await updateDoc(roomRef, {
      board: newBoard,
      hands: newHands,
      winner: newWinner,
      turn: gameState.turn === 'P1' ? 'P2' : 'P1'
    });
    
    setSelected(null);
    setValidDestinations([]);
  };

  const executeDrop = async (player, pieceType, handIndex, toIndex) => {
    if (!user || !roomId) return;
    const newBoard = [...gameState.board];
    const newHands = { ...gameState.hands };

    newBoard[toIndex] = { owner: player, type: pieceType };
    newHands[player].splice(handIndex, 1);

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomId);
    await updateDoc(roomRef, {
      board: newBoard,
      hands: newHands,
      turn: gameState.turn === 'P1' ? 'P2' : 'P1'
    });
    
    setSelected(null);
    setValidDestinations([]);
  };

  const resetGame = async () => {
    if (!user || !roomId) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomId);
    await updateDoc(roomRef, {
      board: getInitialBoard(),
      turn: 'P1',
      hands: { P1: [], P2: [] },
      winner: null,
      status: gameState.players.P2 ? 'playing' : 'waiting'
    });
    setSelected(null);
    setValidDestinations([]);
  };

  // --- Render Helpers ---
  const isSelected = (index) => selected?.origin === 'board' && selected.index === index;
  const isValidDest = (index) => validDestinations.includes(index);
  const isMyTurn = gameState.turn === playerRole;

  if (!roomId) {
    return (
      <div className="min-h-screen bg-[#fef9f0] flex flex-col items-center justify-center p-4 font-sans text-gray-800">
         <div className="bg-white p-8 rounded-3xl shadow-xl border-4 border-amber-200 max-w-md w-full text-center">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-orange-600 mb-6 drop-shadow-sm">🦁 どうぶつしょうぎ</h1>
            <p className="mb-6 text-gray-600 font-medium">友達とオンライン対戦しよう！</p>
            
            {user ? (
               <div className="space-y-6">
                  <div>
                     <button onClick={handleCreateRoom} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-6 rounded-full shadow-md transition-all text-lg border-b-4 border-orange-700 active:border-b-0 active:translate-y-1">
                       部屋を作る (Create Room)
                     </button>
                  </div>
                  <div className="flex items-center justify-center space-x-2">
                    <span className="h-px bg-gray-300 w-full"></span>
                    <span className="text-gray-400 font-medium text-sm">または</span>
                    <span className="h-px bg-gray-300 w-full"></span>
                  </div>
                  <div className="flex flex-col space-y-3">
                     <input 
                       type="text" 
                       placeholder="合言葉(ルームID)を入力" 
                       value={joinRoomId}
                       onChange={(e) => setJoinRoomId(e.target.value)}
                       className="w-full text-center text-xl font-bold p-3 border-2 border-orange-200 rounded-xl focus:outline-none focus:border-orange-500 uppercase"
                       maxLength={6}
                     />
                     <button onClick={handleJoinRoom} className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-full shadow-md transition-all text-lg border-b-4 border-blue-700 active:border-b-0 active:translate-y-1">
                       部屋に入る (Join Room)
                     </button>
                  </div>
                  {lobbyError && <p className="text-red-500 font-bold">{lobbyError}</p>}
                  <p className="text-xs text-gray-400 mt-4 break-all">Player ID: {user.uid}</p>
               </div>
            ) : (
               <div className="flex flex-col items-center space-y-3 py-6">
                 <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                 <p className="text-gray-500 font-medium">サーバーに接続中...</p>
               </div>
            )}
         </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fef9f0] flex flex-col items-center py-4 px-2 sm:px-4 font-sans select-none text-gray-800">
      
      {/* Header Info */}
      <div className="text-center mb-4 flex flex-col items-center w-full max-w-md">
        <div className="flex justify-between w-full items-center mb-3 bg-white p-2 rounded-xl shadow-sm border border-orange-100">
           <button onClick={leaveRoom} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-1.5 rounded-full font-bold transition-colors">
             退出する
           </button>
           <div className="flex flex-col items-end">
             <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">ルームID (合言葉)</span>
             <span className="text-lg text-orange-600 font-black tracking-widest">{roomId}</span>
           </div>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-orange-600 drop-shadow-sm mb-1">
          🦁 どうぶつしょうぎ 🐥
        </h1>
        <p className="text-sm font-bold text-gray-600 bg-white/50 px-3 py-1 rounded-full">
          あなたは: {playerRole === 'P1' ? 'プレイヤー1 (手前)' : 'プレイヤー2 (奥)'}
        </p>
      </div>

      {gameState.status === 'waiting' && (
        <div className="mb-4 bg-yellow-100 border border-yellow-300 text-yellow-800 px-6 py-3 rounded-xl font-bold shadow-sm animate-pulse w-full max-w-md text-center">
          対戦相手を待っています...<br/>
          <span className="text-sm font-normal">友達に合言葉「<strong className="text-lg">{roomId}</strong>」を教えてね！</span>
        </div>
      )}

      {/* Game Area */}
      <div className="flex flex-col items-center bg-white p-3 sm:p-6 rounded-3xl shadow-xl border-4 border-amber-200 w-full max-w-[28rem] relative">
        
        {/* Waiting Block Overlay */}
        {gameState.status === 'playing' && !gameState.winner && !isMyTurn && (
          <div className="absolute inset-0 z-20 bg-white/30 backdrop-blur-[1.5px] rounded-2xl flex items-center justify-center">
             <div className="bg-gray-800/90 text-white px-6 py-3 rounded-full font-bold shadow-xl animate-bounce-short flex items-center space-x-2">
               <div className="w-2 h-2 bg-orange-400 rounded-full animate-ping"></div>
               <span>相手のターンです...</span>
             </div>
          </div>
        )}

        <div className="w-full flex justify-between items-center mb-4 sm:mb-6 px-1">
          <div className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-bold shadow-sm transition-all ${gameState.turn === 'P2' && !gameState.winner ? 'bg-red-500 text-white scale-105 shadow-md ring-2 ring-red-300 ring-offset-1' : 'bg-gray-100 text-gray-400'}`}>
            Player 2 (奥) {playerRole === 'P2' ? ' - あなた' : ''}
          </div>
          <div className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-bold shadow-sm transition-all ${gameState.turn === 'P1' && !gameState.winner ? 'bg-blue-500 text-white scale-105 shadow-md ring-2 ring-blue-300 ring-offset-1' : 'bg-gray-100 text-gray-400'}`}>
            Player 1 (手前) {playerRole === 'P1' ? ' - あなた' : ''}
          </div>
        </div>

        {/* P2 Hand */}
        <div className="w-full bg-red-50/50 rounded-xl p-2 sm:p-3 mb-3 min-h-[3.5rem] border-2 border-red-100 flex flex-wrap gap-1.5 sm:gap-2 items-center justify-center shadow-inner">
           {gameState.hands.P2.length === 0 ? <span className="text-red-300 text-xs sm:text-sm font-medium">もちごま (から)</span> : null}
           {gameState.hands.P2.map((type, idx) => (
             <div 
                key={`p2-hand-${idx}`}
                onClick={() => handleHandClick('P2', type, idx)}
                className={`w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center text-2xl sm:text-3xl bg-white rounded-lg shadow-sm border border-red-200 cursor-pointer transform rotate-180 hover:bg-red-100 transition-colors
                  ${selected?.origin === 'hand' && selected.player === 'P2' && selected.handIndex === idx ? 'ring-4 ring-yellow-400 bg-yellow-50 scale-110 z-10' : ''}
                `}
             >
               {PIECES[type].emoji}
             </div>
           ))}
        </div>

        {/* Board */}
        <div className="bg-[#e4a854] p-1.5 sm:p-3 rounded-xl shadow-lg border-4 border-[#b97a33] mb-3 w-full">
          <div className="grid grid-cols-3 gap-1 sm:gap-2">
            {gameState.board.map((piece, index) => {
              const bgPattern = (Math.floor(index / COLS) + index % COLS) % 2 === 0 ? 'bg-[#f7d698]' : 'bg-[#eed092]';
              return (
                <div
                  key={index}
                  onClick={() => handleSquareClick(index)}
                  className={`relative aspect-square flex items-center justify-center rounded-lg cursor-pointer transition-all duration-200
                    ${bgPattern}
                    ${isValidDest(index) ? 'ring-4 ring-inset ring-green-400 brightness-110' : ''}
                    hover:brightness-105
                  `}
                >
                  {isValidDest(index) && !piece && (
                     <div className="absolute w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-green-500 opacity-60"></div>
                  )}
                  {piece && (
                    <div
                      className={`w-[85%] h-[90%] rounded-md flex flex-col items-center justify-center shadow-[0_3px_0_0_rgba(0,0,0,0.15)] active:shadow-none active:translate-y-1 transition-all
                        ${piece.owner === 'P1' ? 'bg-blue-100 border-2 border-blue-300 text-blue-900' : 'bg-red-100 border-2 border-red-300 text-red-900 transform rotate-180'}
                        ${isSelected(index) ? 'ring-4 ring-yellow-400 ring-offset-2 scale-105 z-10' : ''}
                      `}
                    >
                      <span className="text-3xl sm:text-5xl filter drop-shadow-sm">{PIECES[piece.type].emoji}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* P1 Hand */}
        <div className="w-full bg-blue-50/50 rounded-xl p-2 sm:p-3 mt-1 min-h-[3.5rem] border-2 border-blue-100 flex flex-wrap gap-1.5 sm:gap-2 items-center justify-center shadow-inner">
           {gameState.hands.P1.length === 0 ? <span className="text-blue-300 text-xs sm:text-sm font-medium">もちごま (から)</span> : null}
           {gameState.hands.P1.map((type, idx) => (
             <div 
                key={`p1-hand-${idx}`}
                onClick={() => handleHandClick('P1', type, idx)}
                className={`w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center text-2xl sm:text-3xl bg-white rounded-lg shadow-sm border border-blue-200 cursor-pointer hover:bg-blue-100 transition-colors
                  ${selected?.origin === 'hand' && selected.player === 'P1' && selected.handIndex === idx ? 'ring-4 ring-yellow-400 bg-yellow-50 scale-110 z-10' : ''}
                `}
             >
               {PIECES[type].emoji}
             </div>
           ))}
        </div>

      </div>

      {gameState.winner && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-8 shadow-2xl flex flex-col items-center max-w-sm w-full animate-bounce-short">
            <div className="text-6xl mb-4">🏆</div>
            <h2 className="text-2xl sm:text-3xl font-black text-gray-800 mb-2 text-center">
              {gameState.winner === 'P1' ? (
                <span className="text-blue-500">Player 1 の勝ち！</span>
              ) : (
                <span className="text-red-500">Player 2 の勝ち！</span>
              )}
            </h2>
            <p className="text-gray-600 text-center mb-6 font-medium">ライオンがつかまりました！</p>
            {gameState.winner === playerRole && (
                <p className="text-green-600 font-bold mb-4">🎉 おめでとうございます！ 🎉</p>
            )}
            <button 
              onClick={resetGame}
              className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-8 rounded-full shadow-lg hover:shadow-xl transition-all w-full text-lg sm:text-xl border-b-4 border-orange-700 active:border-b-0 active:translate-y-1"
            >
              もう一度あそぶ
            </button>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes bounce-short {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        .animate-bounce-short {
          animation: bounce-short 1.5s ease-in-out infinite;
        }
      `}} />
    </div>
  );
}
