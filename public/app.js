import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  collection,
  addDoc,
  updateDoc,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  increment,
  serverTimestamp,
  connectFirestoreEmulator,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Demo Firebase Config
const firebaseConfig = {
  apiKey: "demo-api-key",
  authDomain: "demo-project.firebaseapp.com",
  projectId: "demo-project",
  storageBucket: "demo-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:123456789"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Connect to Emulators if running locally
if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

// Global Application State
let currentUser = null;
let currentRoomId = "LT-2026";
let currentMode = "participant"; // "participant" or "presenter"
let currentSort = "popular"; // "popular" or "newest"
let questionsCache = [];
let roomUnsubscribe = null;
let questionsUnsubscribe = null;

// Emojis dictionary
const EMOJI_MAP = {
  clap: "👏",
  idea: "💡",
  smile: "😂",
  question: "❓"
};

// DOM Elements
const roomDisplayName = document.getElementById("room-display-name");
const changeRoomBtn = document.getElementById("change-room-btn");
const modeParticipantBtn = document.getElementById("mode-participant-btn");
const modePresenterBtn = document.getElementById("mode-presenter-btn");
const questionFormSection = document.getElementById("question-form-section");
const questionForm = document.getElementById("question-form");
const questionContentInput = document.getElementById("question-content");
const authorNameInput = document.getElementById("author-name");
const sortPopularBtn = document.getElementById("sort-popular-btn");
const sortNewestBtn = document.getElementById("sort-newest-btn");
const questionsList = document.getElementById("questions-list");
const emptyState = document.getElementById("empty-state");
const questionCountBadge = document.getElementById("question-count-badge");
const emojiContainer = document.getElementById("emoji-container");

// Reaction Count Elements
const reactionCounts = {
  clap: document.getElementById("count-clap"),
  idea: document.getElementById("count-idea"),
  smile: document.getElementById("count-smile"),
  question: document.getElementById("count-question")
};

// Application Initialization
async function init() {
  setupEventListeners();

  // Anonymous Authentication
  try {
    const userCredential = await signInAnonymously(auth);
    currentUser = userCredential.user;
  } catch (error) {
    console.error("Auth error:", error);
  }

  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      subscribeToRoomData(currentRoomId);
    }
  });
}

// Switch Active Room
function setRoom(roomId) {
  if (!roomId || roomId.trim() === "") return;
  const sanitizedId = roomId.trim().replace(/^#/, "");
  currentRoomId = sanitizedId;
  roomDisplayName.textContent = `#${sanitizedId}`;

  // Re-subscribe to new room
  subscribeToRoomData(currentRoomId);
}

window.setRoom = setRoom;

// Room Data & Questions Subscriptions
function subscribeToRoomData(roomId) {
  if (roomUnsubscribe) roomUnsubscribe();
  if (questionsUnsubscribe) questionsUnsubscribe();

  const roomRef = doc(db, "rooms", roomId);

  // Subscribe to Room Document (Reactions)
  roomUnsubscribe = onSnapshot(roomRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data();
      updateReactionCounts(data.reactions || {});
    } else {
      // Create initial room doc if not present
      setDoc(roomRef, {
        title: roomId,
        createdAt: serverTimestamp(),
        reactions: { clap: 0, idea: 0, smile: 0, question: 0 }
      }, { merge: true });
    }
  }, (err) => console.error("Room snapshot error:", err));

  // Subscribe to Questions Subcollection
  const questionsRef = collection(db, "rooms", roomId, "questions");
  questionsUnsubscribe = onSnapshot(questionsRef, (snapshot) => {
    questionsCache = snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
    renderQuestions();
  }, (err) => console.error("Questions snapshot error:", err));
}

// Update Reaction Counter Displays
function updateReactionCounts(reactions) {
  Object.keys(EMOJI_MAP).forEach(key => {
    if (reactionCounts[key]) {
      reactionCounts[key].textContent = reactions[key] || 0;
    }
  });
}

// Floating Emoji Animation
function spawnFloatingEmoji(emoji) {
  const el = document.createElement("div");
  el.className = "floating-emoji";
  el.textContent = emoji;

  // Randomize horizontal positioning (10% ~ 90%)
  const randomX = Math.floor(Math.random() * 80) + 10;
  el.style.left = `${randomX}%`;

  emojiContainer.appendChild(el);

  // Remove element after animation completes
  setTimeout(() => {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }, 2300);
}

// Handle Reaction Click
async function handleReaction(type) {
  if (!type || !EMOJI_MAP[type]) return;

  // Trigger floating animation locally for instant feedback
  spawnFloatingEmoji(EMOJI_MAP[type]);

  if (!currentRoomId) return;

  const roomRef = doc(db, "rooms", currentRoomId);
  try {
    await updateDoc(roomRef, {
      [`reactions.${type}`]: increment(1)
    });
  } catch (error) {
    // If updateDoc fails (e.g., doc doesn't exist), fallback to setDoc merge
    await setDoc(roomRef, {
      reactions: {
        [type]: increment(1)
      }
    }, { merge: true });
  }
}

// Render Questions List
function renderQuestions() {
  if (!questionsCache || questionsCache.length === 0) {
    questionsList.innerHTML = "";
    questionsList.appendChild(emptyState);
    questionCountBadge.textContent = "0";
    return;
  }

  questionCountBadge.textContent = questionsCache.length.toString();

  // Sort Copy of Questions
  const sorted = [...questionsCache].sort((a, b) => {
    if (currentSort === "popular") {
      const upvotesA = a.upvotes || 0;
      const upvotesB = b.upvotes || 0;
      if (upvotesB !== upvotesA) return upvotesB - upvotesA;
      // Secondary sort: creation time descending
      const timeA = a.createdAt?.seconds || 0;
      const timeB = b.createdAt?.seconds || 0;
      return timeB - timeA;
    } else {
      // Newest first
      const timeA = a.createdAt?.seconds || 0;
      const timeB = b.createdAt?.seconds || 0;
      return timeB - timeA;
    }
  });

  questionsList.innerHTML = "";

  sorted.forEach(q => {
    const isUpvoted = currentUser && Array.isArray(q.upvotedBy) && q.upvotedBy.includes(currentUser.uid);
    const card = document.createElement("div");

    card.className = `p-4 bg-white rounded-2xl border transition-all duration-200 ${
      q.isAnswered ? "border-slate-200 bg-slate-50/70 opacity-75" : "border-slate-200 shadow-sm hover:border-indigo-200"
    }`;

    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 space-y-2">
          <div class="flex items-center space-x-2 flex-wrap gap-y-1">
            <span class="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full">
              ${escapeHtml(q.authorName || "匿名")}
            </span>
            ${
              q.isAnswered
                ? `<span class="inline-flex items-center text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                    ✓ 回答済み
                   </span>`
                : `<span class="inline-flex items-center text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-full">
                    未回答
                   </span>`
            }
          </div>
          <p class="text-sm font-medium text-slate-800 whitespace-pre-wrap leading-relaxed">${escapeHtml(q.content)}</p>
        </div>

        <!-- Upvote Button -->
        <button
          data-question-id="${q.id}"
          class="upvote-btn flex flex-col items-center justify-center min-w-[50px] px-3 py-2 rounded-xl border transition-all ${
            isUpvoted
              ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
              : "bg-slate-50 hover:bg-indigo-50 border-slate-200 text-slate-600 hover:text-indigo-600"
          }"
        >
          <span class="text-xs font-black">▲</span>
          <span class="text-xs font-bold mt-0.5">${q.upvotes || 0}</span>
        </button>
      </div>

      <!-- Presenter Action Bar -->
      ${
        currentMode === "presenter"
          ? `<div class="mt-3 pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
              <button
                data-toggle-answered="${q.id}"
                data-current-state="${q.isAnswered || false}"
                class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  q.isAnswered
                    ? "bg-slate-200 hover:bg-slate-300 text-slate-700"
                    : "bg-emerald-600 hover:bg-emerald-700 text-white"
                }"
              >
                ${q.isAnswered ? "未回答に戻す" : "✓ 回答済みにする"}
              </button>
            </div>`
          : ""
      }
    `;

    questionsList.appendChild(card);
  });
}

// Toggle Upvote for Question
async function toggleUpvote(questionId) {
  if (!currentUser) return;
  const question = questionsCache.find(q => q.id === questionId);
  if (!question) return;

  const isUpvoted = Array.isArray(question.upvotedBy) && question.upvotedBy.includes(currentUser.uid);
  const questionRef = doc(db, "rooms", currentRoomId, "questions", questionId);

  try {
    if (isUpvoted) {
      await updateDoc(questionRef, {
        upvotes: increment(-1),
        upvotedBy: arrayRemove(currentUser.uid)
      });
    } else {
      await updateDoc(questionRef, {
        upvotes: increment(1),
        upvotedBy: arrayUnion(currentUser.uid)
      });
    }
  } catch (err) {
    console.error("Upvote error:", err);
  }
}

// Toggle Answered State (Presenter Mode)
async function toggleAnswered(questionId, currentState) {
  const questionRef = doc(db, "rooms", currentRoomId, "questions", questionId);
  try {
    await updateDoc(questionRef, {
      isAnswered: !currentState
    });
  } catch (err) {
    console.error("Toggle answered error:", err);
  }
}

// Handle New Question Submission
async function handleQuestionSubmit(e) {
  e.preventDefault();
  const content = questionContentInput.value.trim();
  const authorName = authorNameInput.value.trim() || "匿名";

  if (!content) return;

  try {
    const questionsRef = collection(db, "rooms", currentRoomId, "questions");
    await addDoc(questionsRef, {
      content: content,
      authorName: authorName,
      userId: currentUser ? currentUser.uid : "anonymous",
      upvotes: 0,
      upvotedBy: [],
      isAnswered: false,
      createdAt: serverTimestamp()
    });

    questionContentInput.value = "";
  } catch (error) {
    console.error("Add question error:", error);
  }
}

// Setup DOM Event Listeners
function setupEventListeners() {
  // Mode Switch
  modeParticipantBtn.addEventListener("click", () => {
    currentMode = "participant";
    modeParticipantBtn.className = "px-3 py-1.5 rounded-lg transition-all duration-200 bg-white text-indigo-600 shadow-sm";
    modePresenterBtn.className = "px-3 py-1.5 rounded-lg transition-all duration-200 text-slate-600 hover:text-slate-900";
    questionFormSection.classList.remove("hidden");
    renderQuestions();
  });

  modePresenterBtn.addEventListener("click", () => {
    currentMode = "presenter";
    modePresenterBtn.className = "px-3 py-1.5 rounded-lg transition-all duration-200 bg-white text-indigo-600 shadow-sm";
    modeParticipantBtn.className = "px-3 py-1.5 rounded-lg transition-all duration-200 text-slate-600 hover:text-slate-900";
    questionFormSection.classList.add("hidden");
    renderQuestions();
  });

  // Sort Switch
  sortPopularBtn.addEventListener("click", () => {
    currentSort = "popular";
    sortPopularBtn.className = "px-3 py-1 rounded-lg bg-white text-slate-900 shadow-sm font-semibold transition-all";
    sortNewestBtn.className = "px-3 py-1 rounded-lg text-slate-600 hover:text-slate-900 transition-all";
    renderQuestions();
  });

  sortNewestBtn.addEventListener("click", () => {
    currentSort = "newest";
    sortNewestBtn.className = "px-3 py-1 rounded-lg bg-white text-slate-900 shadow-sm font-semibold transition-all";
    sortPopularBtn.className = "px-3 py-1 rounded-lg text-slate-600 hover:text-slate-900 transition-all";
    renderQuestions();
  });

  // Question Form Submission
  questionForm.addEventListener("submit", handleQuestionSubmit);

  // Change Room Button
  changeRoomBtn.addEventListener("click", () => {
    const input = prompt("ルームIDを入力してください:", currentRoomId);
    if (input) setRoom(input);
  });

  // Event Delegation for Questions List (Upvote & Answered Toggle)
  questionsList.addEventListener("click", (e) => {
    const upvoteBtn = e.target.closest(".upvote-btn");
    if (upvoteBtn) {
      const qId = upvoteBtn.getAttribute("data-question-id");
      if (qId) toggleUpvote(qId);
      return;
    }

    const toggleAnsweredBtn = e.target.closest("[data-toggle-answered]");
    if (toggleAnsweredBtn) {
      const qId = toggleAnsweredBtn.getAttribute("data-toggle-answered");
      const currentState = toggleAnsweredBtn.getAttribute("data-current-state") === "true";
      if (qId) toggleAnswered(qId, currentState);
      return;
    }
  });

  // Reaction Buttons
  document.querySelectorAll(".reaction-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-reaction");
      handleReaction(type);
    });
  });
}

// Utility: HTML Escape Helper
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Initialize on DOM Loaded
document.addEventListener("DOMContentLoaded", init);
