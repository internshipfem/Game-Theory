let playerScore = 0;
let aiScore = 0;
let round = 1;
let maxRounds = 10;

let isLoadingState = false;
let isAutoSaveEnabled = true;

let playerHistory = [];
let aiHistory = [];
let player1ManualChoice = "cooperate";
let player2ManualChoice = "cooperate";

// Strategy Definition System
const builtInStrategies = {
    angel: {
        name: "Angel",
        type: "built-in",
        description: "Always cooperates",
        codeText: 'return "cooperate"',
        func: function(myHistory, opponentHistory) { return "cooperate"; }
    },
    snake: {
        name: "Snake",
        type: "built-in",
        description: "Always betrays",
        codeText: 'return "betray"',
        func: function(myHistory, opponentHistory) { return "betray"; }
    },
    titfortat: {
        name: "Tit for Tat",
        type: "built-in",
        description: "Copies opponent's last move",
        codeText: 'if len(opponent_history) == 0:\n    return "cooperate"\nreturn opponent_history[-1]',
        func: function(myHistory, opponentHistory) {
            if (opponentHistory.length === 0) return "cooperate";
            return opponentHistory[opponentHistory.length - 1];
        }
    },
    random: {
        name: "Random",
        type: "built-in",
        description: "50% cooperate, 50% betray",
        codeText: 'return "cooperate" if random.random() < 0.5 else "betray"',
        func: function(myHistory, opponentHistory) {
            return Math.random() < 0.5 ? "cooperate" : "betray";
        }
    },
    grudger: {
        name: "Grudger",
        type: "built-in",
        description: "Cooperates until betrayed, then betrays forever",
        codeText: 'if "betray" in opponent_history:\n    return "betray"\nreturn "cooperate"',
        func: function(myHistory, opponentHistory) {
            return opponentHistory.includes("betray") ? "betray" : "cooperate";
        }
    }
};

let customStrategies = {};

const templates = {
    titfortwotats: {
        name: "Tit for Two Tats",
        code: `# Cooperates unless the opponent betrays twice in a row
if len(opponent_history) < 2:
    return "cooperate"
last = opponent_history[-1]
second_last = opponent_history[-2]
if last == "betray" and second_last == "betray":
    return "betray"
return "cooperate"`
    },
    alternator: {
        name: "Alternator",
        code: `# Alternates between cooperating and betraying
return "cooperate" if len(my_history) % 2 == 0 else "betray"`
    },
    pavlov: {
        name: "Pavlov (Win-Stay, Lose-Shift)",
        code: `# Cooperates on first round.
# After that, cooperates if both made the same move last round.
# Otherwise, betrays.
if len(my_history) == 0:
    return "cooperate"
my_last = my_history[-1]
opp_last = opponent_history[-1]
return "cooperate" if my_last == opp_last else "betray"`
    },
    majority: {
        name: "Majority Cooperator",
        code: `# Cooperates unless opponent has betrayed in more than 50% of rounds
if len(opponent_history) == 0:
    return "cooperate"
betrays = opponent_history.count("betray")
return "betray" if betrays > len(opponent_history) / 2 else "cooperate"`
    }
};

// Helper: execute a Python strategy via the server
async function executePythonStrategy(code, myHistory, opponentHistory) {
    const response = await fetch("/api/execute_strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            code: code,
            my_history: myHistory,
            opponent_history: opponentHistory
        })
    });
    const data = await response.json();
    if (data.error) {
        throw new Error(data.error);
    }
    return data.result;
}

async function getMoveForStrategy(strategyKey, selfHistory, opponentHistory, isPlayer1) {
    const strat = builtInStrategies[strategyKey] || customStrategies[strategyKey];
    if (!strat) return "cooperate";

    // Built-in strategies still run locally via JS for speed
    if (strat.type === "built-in" && typeof strat.func === "function") {
        try {
            const move = strat.func(selfHistory, opponentHistory);
            if (move === "cooperate" || move === "betray") return move;
        } catch (e) {
            console.error("Error running built-in strategy " + strategyKey, e);
        }
        return "cooperate";
    }

    // Custom strategies: execute Python code on server
    if (strat.codeText) {
        try {
            const move = await executePythonStrategy(strat.codeText, selfHistory, opponentHistory);
            if (move === "cooperate" || move === "betray") return move;
        } catch (e) {
            console.error("Error running custom strategy " + strategyKey, e);
        }
    }
    return "cooperate";
}

function loadCustomStrategies() {
    try {
        const stored = localStorage.getItem("trust_loop_custom_strategies");
        if (stored) {
            const parsed = JSON.parse(stored);
            for (const key in parsed) {
                const item = parsed[key];
                customStrategies[key] = {
                    name: item.name,
                    type: "custom",
                    description: item.description || "Custom strategy",
                    codeText: item.codeText
                };
            }
        }
    } catch (e) {
        console.error("Error loading custom strategies:", e);
    }
}

function saveCustomStrategiesToStorage() {
    const toSave = {};
    for (const key in customStrategies) {
        const item = customStrategies[key];
        toSave[key] = {
            name: item.name,
            codeText: item.codeText,
            description: item.description
        };
    }
    localStorage.setItem("trust_loop_custom_strategies", JSON.stringify(toSave));
}

function setManualChoice(playerNum, choice) {
    if (playerNum === 1) {
        player1ManualChoice = choice;
        document.getElementById("p1-cooperate").classList.toggle("active", choice === "cooperate");
        document.getElementById("p1-betray").classList.toggle("active", choice === "betray");
    } else {
        player2ManualChoice = choice;
        document.getElementById("p2-cooperate").classList.toggle("active", choice === "cooperate");
        document.getElementById("p2-betray").classList.toggle("active", choice === "betray");
    }
}

function handleStrategyChange() {
    const p1Strat = document.getElementById("player1-strategy").value;
    const p2Strat = document.getElementById("player2-strategy").value;

    const p1ManualContainer = document.getElementById("player1-manual-choice");
    const p2ManualContainer = document.getElementById("player2-manual-choice");

    if (p1Strat === "manual") {
        p1ManualContainer.style.display = "flex";
    } else {
        p1ManualContainer.style.display = "none";
    }

    if (p2Strat === "manual") {
        p2ManualContainer.style.display = "flex";
    } else {
        p2ManualContainer.style.display = "none";
    }
    triggerAutoSave();
}

async function playRound() {
    if (round > maxRounds) {
        document.getElementById("result").innerText = "Game over. Click reset to play again.";
        return;
    }

    const p1Strat = document.getElementById("player1-strategy").value;
    const p2Strat = document.getElementById("player2-strategy").value;

    // Determine Player 1 move
    let playerMove;
    if (p1Strat === "manual") {
        playerMove = player1ManualChoice;
    } else {
        playerMove = await getMoveForStrategy(p1Strat, playerHistory, aiHistory, true);
    }

    // Determine Player 2 move
    let aiMove;
    if (p2Strat === "manual") {
        aiMove = player2ManualChoice;
    } else {
        aiMove = await getMoveForStrategy(p2Strat, aiHistory, playerHistory, false);
    }

    const payoff_cc = parseInt(document.getElementById("param-cc").value) || 3;
    const payoff_dd = parseInt(document.getElementById("param-dd").value) || 1;
    const payoff_t = parseInt(document.getElementById("param-t").value) || 5;
    const payoff_s = parseInt(document.getElementById("param-s").value) || 0;

    try {
        const response = await fetch("/game_master", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                player_move: playerMove,
                opponent_move: aiMove,
                payoff_cc: payoff_cc,
                payoff_dd: payoff_dd,
                payoff_t: payoff_t,
                payoff_s: payoff_s
            })
        });
        const data = await response.json();

        playerScore += data.player_change;
        aiScore += data.opponent_change;

        playerHistory.push(playerMove);
        aiHistory.push(aiMove);

        document.getElementById("player-score").innerText = playerScore;
        document.getElementById("ai-score").innerText = aiScore;

        const p1Name = p1Strat === "manual" ? "Player 1 (You)" : `Player 1 (${p1Strat})`;
        const p2Name = p2Strat === "manual" ? "Player 2" : `Player 2 (${p2Strat})`;

        document.getElementById("result").innerText =
            `${p1Name} chose ${playerMove}.\n${p2Name} chose ${aiMove}.\n\nGame Master: ${data.message}`;

        // Append to Match History
        const historyCard = document.getElementById("game-history-card");
        const historyTableBody = document.querySelector("#history-table tbody");
        if (historyCard && historyTableBody) {
            historyCard.style.display = "block";
            const currentRound = playerHistory.length;
            const p1MoveText = playerMove === "cooperate" ? "🤝 Cooperate" : "⚔️ Betray";
            const p2MoveText = aiMove === "cooperate" ? "🤝 Cooperate" : "⚔️ Betray";
            const p1Class = playerMove === "cooperate" ? "cooperate" : "betray";
            const p2Class = aiMove === "cooperate" ? "cooperate" : "betray";
            const rowHTML = `
                <tr>
                    <td><strong>#${currentRound}</strong></td>
                    <td><span class="move-badge ${p1Class}">${p1MoveText}</span></td>
                    <td><span class="move-badge ${p2Class}">${p2MoveText}</span></td>
                    <td><span class="payoff-badge">+${data.player_change} / +${data.opponent_change}</span></td>
                </tr>
            `;
            historyTableBody.innerHTML += rowHTML;
        }

        round++;

        if (round <= maxRounds) {
            document.getElementById("round").innerText = round;
        } else {
            showFinalResult();
        }
        triggerAutoSave();
    } catch (error) {
        console.error("Error communicating with Game Master:", error);
        document.getElementById("result").innerText = "Error contacting Game Master. Try again.";
    }
}

function showFinalResult() {
    let message = "";

    if (playerScore > aiScore) {
        message = "Player 1 won! But did you build trust?";
    } else if (playerScore < aiScore) {
        message = "Player 2 won. Try changing your strategy.";
    } else {
        message = "Draw. Both sides ended equally.";
    }

    document.getElementById("result").innerText += "\n\n" + message;
}

function resetGame() {
    playerScore = 0;
    aiScore = 0;
    round = 1;
    playerHistory = [];
    aiHistory = [];

    // Reset manual choice active classes
    setManualChoice(1, "cooperate");
    setManualChoice(2, "cooperate");

    document.getElementById("player-score").innerText = 0;
    document.getElementById("ai-score").innerText = 0;
    document.getElementById("round").innerText = 1;
    document.getElementById("result").innerText = "Make your first move.";

    // Reset Match History
    const historyCard = document.getElementById("game-history-card");
    const historyTableBody = document.querySelector("#history-table tbody");
    if (historyCard && historyTableBody) {
        historyCard.style.display = "none";
        historyTableBody.innerHTML = "";
    }
    triggerAutoSave();
}

function startGame() {
    document.getElementById("intro-screen").style.display = "none";
    document.getElementById("game-screen").style.display = "block";
    document.getElementById("tabs-header").style.display = "flex";
}

function initPayoffSync() {
    const ccInputs = ["param-cc", "banner-cc"];
    const ddInputs = ["param-dd", "banner-dd"];
    const tInputs = ["param-t", "param-t-coop", "banner-t"];
    const sInputs = ["param-s", "param-s-coop", "banner-s"];

    function syncGroup(elements, val) {
        elements.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.value !== val) {
                el.value = val;
            }
        });
    }

    function setupListeners(ids, group) {
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener("input", (e) => {
                    syncGroup(group, e.target.value);
                });
                el.addEventListener("change", () => {
                    triggerAutoSave();
                });
            }
        });
    }

    setupListeners(ccInputs, ccInputs);
    setupListeners(ddInputs, ddInputs);
    setupListeners(tInputs, tInputs);
    setupListeners(sInputs, sInputs);
}

// Call directly since script runs at the bottom of the body
initPayoffSync();

// Tab switching logic
function switchTab(tabId) {
    const gameScreen = document.getElementById("game-screen");
    const introScreen = document.getElementById("intro-screen");
    const arenaScreen = document.getElementById("arena-screen");
    const container = document.querySelector(".game-container");

    const gameTabBtn = document.getElementById("tab-game-btn");
    const arenaTabBtn = document.getElementById("tab-arena-btn");

    if (tabId === "game") {
        gameTabBtn.classList.add("active");
        arenaTabBtn.classList.remove("active");
        arenaScreen.style.display = "none";
        container.classList.remove("arena-mode");

        const hasStarted = (document.getElementById("intro-screen").style.display === "none");
        if (hasStarted) {
            gameScreen.style.display = "block";
            introScreen.style.display = "none";
        } else {
            introScreen.style.display = "block";
            gameScreen.style.display = "none";
        }
    } else {
        arenaTabBtn.classList.add("active");
        gameTabBtn.classList.remove("active");
        
        gameScreen.style.display = "none";
        introScreen.style.display = "none";
        arenaScreen.style.display = "block";
        container.classList.add("arena-mode");
    }
}

// Template loader logic
function loadTemplate() {
    const templateKey = document.getElementById("strategy-template").value;
    const codeArea = document.getElementById("strategy-code");
    if (templateKey && templates[templateKey]) {
        codeArea.value = templates[templateKey].code;
    } else {
        codeArea.value = "";
    }
}

// Strategy Save logic
async function saveCustomStrategy() {
    const nameInput = document.getElementById("strategy-name");
    const codeArea = document.getElementById("strategy-code");
    const msgDiv = document.getElementById("strategy-validation-msg");

    const name = nameInput.value.trim();
    const code = codeArea.value;

    msgDiv.style.display = "none";
    msgDiv.className = "validation-msg";

    if (!name) {
        msgDiv.innerText = "Please specify a strategy name.";
        msgDiv.classList.add("error");
        msgDiv.style.display = "block";
        return;
    }

    const normalizedId = name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (builtInStrategies[normalizedId] || customStrategies[normalizedId]) {
        if (builtInStrategies[normalizedId]) {
            msgDiv.innerText = `A built-in strategy with name "${name}" already exists.`;
            msgDiv.classList.add("error");
            msgDiv.style.display = "block";
            return;
        } else {
            if (!confirm(`Overwrite existing strategy "${name}"?`)) {
                return;
            }
        }
    }

    try {
        // Validate Python code on the server
        msgDiv.innerText = "Validating Python code...";
        msgDiv.classList.add("info");
        msgDiv.style.display = "block";

        const response = await fetch("/api/validate_strategy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: code })
        });
        const result = await response.json();

        if (!result.valid) {
            throw new Error(result.error || "Validation failed.");
        }

        customStrategies[normalizedId] = {
            name: name,
            type: "custom",
            description: "User defined strategy",
            codeText: code
        };

        saveCustomStrategiesToStorage();
        updateStrategySelects();
        renderActiveStrategies();
        triggerAutoSave();

        msgDiv.className = "validation-msg";
        msgDiv.innerText = `Successfully saved strategy "${name}"!`;
        msgDiv.classList.add("success");
        msgDiv.style.display = "block";

        nameInput.value = "";
        codeArea.value = "";
        document.getElementById("strategy-template").value = "";

    } catch (err) {
        msgDiv.className = "validation-msg";
        msgDiv.innerText = "Validation Error: " + err.message;
        msgDiv.classList.add("error");
        msgDiv.style.display = "block";
    }
}

// Strategy Delete logic
function deleteCustomStrategy(id) {
    if (customStrategies[id]) {
        if (confirm(`Are you sure you want to delete strategy "${customStrategies[id].name}"?`)) {
            delete customStrategies[id];
            saveCustomStrategiesToStorage();
            updateStrategySelects();
            renderActiveStrategies();
            triggerAutoSave();
        }
    }
}

// Populate the select fields with updated strategies
function updateStrategySelects() {
    const p1Select = document.getElementById("player1-strategy");
    const p2Select = document.getElementById("player2-strategy");

    const p1Val = p1Select.value;
    const p2Val = p2Select.value;

    let p1OptionsHTML = `<option value="manual">Manual (You)</option>`;
    let p2OptionsHTML = `<option value="manual">Manual</option>`;

    for (const key in builtInStrategies) {
        const name = builtInStrategies[key].name;
        p1OptionsHTML += `<option value="${key}">${name}</option>`;
        p2OptionsHTML += `<option value="${key}">${name}</option>`;
    }

    for (const key in customStrategies) {
        const name = customStrategies[key].name;
        p1OptionsHTML += `<option value="${key}">${name} (Custom)</option>`;
        p2OptionsHTML += `<option value="${key}">${name} (Custom)</option>`;
    }

    p1Select.innerHTML = p1OptionsHTML;
    p2Select.innerHTML = p2OptionsHTML;

    if (Array.from(p1Select.options).some(o => o.value === p1Val)) {
        p1Select.value = p1Val;
    } else {
        p1Select.value = "manual";
    }

    if (Array.from(p2Select.options).some(o => o.value === p2Val)) {
        p2Select.value = p2Val;
    } else {
        p2Select.value = "angel";
    }

    handleStrategyChange();
}

// Render active strategies list inside the Arena
function renderActiveStrategies() {
    const listDiv = document.getElementById("active-strategies-list");
    let html = "";

    for (const key in builtInStrategies) {
        const strat = builtInStrategies[key];
        html += `
            <div class="strategy-item">
                <div class="strategy-info-box">
                    <span class="strategy-item-name">${strat.name}</span>
                    <span class="strategy-item-badge built-in">Built-in</span>
                    <span class="strategy-item-desc">${strat.description}</span>
                </div>
            </div>
        `;
    }

    for (const key in customStrategies) {
        const strat = customStrategies[key];
        html += `
            <div class="strategy-item">
                <div class="strategy-info-box">
                    <span class="strategy-item-name">${strat.name}</span>
                    <span class="strategy-item-badge custom">Custom</span>
                    <span class="strategy-item-desc">User-defined logic</span>
                </div>
                <button class="delete-strategy-btn" onclick="deleteCustomStrategy('${key}')">Delete</button>
            </div>
        `;
    }

    listDiv.innerHTML = html;
}

// Run the round-robin tournament
async function runTournament() {
    const roundCountInput = document.getElementById("tournament-rounds");
    const rounds = parseInt(roundCountInput.value) || 10;

    const payoff_cc = parseInt(document.getElementById("param-cc").value) || 3;
    const payoff_dd = parseInt(document.getElementById("param-dd").value) || 1;
    const payoff_t = parseInt(document.getElementById("param-t").value) || 5;
    const payoff_s = parseInt(document.getElementById("param-s").value) || 0;

    const allStrategies = [];
    for (const key in builtInStrategies) {
        allStrategies.push({ key: key, ...builtInStrategies[key] });
    }
    for (const key in customStrategies) {
        allStrategies.push({ key: key, ...customStrategies[key] });
    }

    const totalScores = {};
    allStrategies.forEach(s => {
        totalScores[s.key] = 0;
    });

    const matrix = {};
    allStrategies.forEach(s1 => {
        matrix[s1.key] = {};
    });

    // Show a loading indicator for custom strategies
    const hasCustom = Object.keys(customStrategies).length > 0;
    if (hasCustom) {
        showToast("Running tournament (Python strategies may take a moment)...", "info");
    }

    for (let i = 0; i < allStrategies.length; i++) {
        for (let j = i; j < allStrategies.length; j++) {
            const s1 = allStrategies[i];
            const s2 = allStrategies[j];

            const s1History = [];
            const s2History = [];
            let score1 = 0;
            let score2 = 0;

            for (let r = 0; r < rounds; r++) {
                let move1 = "cooperate";
                let move2 = "cooperate";

                try {
                    move1 = await getMoveForStrategy(s1.key, s1History, s2History, true);
                } catch (e) {
                    console.error(`Error in strategy ${s1.name}`, e);
                }

                try {
                    move2 = await getMoveForStrategy(s2.key, s2History, s1History, false);
                } catch (e) {
                    console.error(`Error in strategy ${s2.name}`, e);
                }

                if (move1 !== "cooperate" && move1 !== "betray") move1 = "cooperate";
                if (move2 !== "cooperate" && move2 !== "betray") move2 = "cooperate";

                s1History.push(move1);
                s2History.push(move2);

                if (move1 === "cooperate" && move2 === "cooperate") {
                    score1 += payoff_cc;
                    score2 += payoff_cc;
                } else if (move1 === "betray" && move2 === "cooperate") {
                    score1 += payoff_t;
                    score2 += payoff_s;
                } else if (move1 === "cooperate" && move2 === "betray") {
                    score1 += payoff_s;
                    score2 += payoff_t;
                } else {
                    score1 += payoff_dd;
                    score2 += payoff_dd;
                }
            }

            matrix[s1.key][s2.key] = [score1, score2];
            matrix[s2.key][s1.key] = [score2, score1];

            if (s1.key === s2.key) {
                totalScores[s1.key] += score1;
            } else {
                totalScores[s1.key] += score1;
                totalScores[s2.key] += score2;
            }
        }
    }

    const ranking = allStrategies.map(s => {
        const total = totalScores[s.key];
        const numOpponents = allStrategies.length;
        const avg = (total / (rounds * numOpponents)).toFixed(2);
        return {
            key: s.key,
            name: s.name,
            type: s.type,
            totalScore: total,
            avgScore: avg
        };
    });

    ranking.sort((a, b) => b.totalScore - a.totalScore);

    document.getElementById("leaderboard-card").style.display = "block";
    document.getElementById("matrix-card").style.display = "block";

    const leaderboardBody = document.querySelector("#leaderboard-table tbody");
    let lbHTML = "";
    ranking.forEach((item, index) => {
        const rank = index + 1;
        let rankClass = "rank-normal";
        let rankText = rank;
        if (rank === 1) { rankClass = "rank-badge rank-1"; rankText = "1"; }
        else if (rank === 2) { rankClass = "rank-badge rank-2"; rankText = "2"; }
        else if (rank === 3) { rankClass = "rank-badge rank-3"; rankText = "3"; }

        const badgeHTML = item.type === "custom" 
            ? `<span class="strategy-item-badge custom">Custom</span>` 
            : `<span class="strategy-item-badge built-in">Built-in</span>`;

        lbHTML += `
            <tr>
                <td><span class="${rankClass}">${rankText}</span></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <strong>${item.name}</strong>
                        ${badgeHTML}
                    </div>
                </td>
                <td><strong>${item.totalScore}</strong> pts</td>
                <td>${item.avgScore} pts</td>
            </tr>
        `;
    });
    leaderboardBody.innerHTML = lbHTML;

    const matrixTable = document.getElementById("matrix-table");
    
    let mHTML = "<thead><tr><th>Strategy</th>";
    allStrategies.forEach(s => {
        mHTML += `<th>${s.name}</th>`;
    });
    mHTML += "</tr></thead><tbody>";

    allStrategies.forEach(s1 => {
        mHTML += `<tr><td><strong>${s1.name}</strong></td>`;
        allStrategies.forEach(s2 => {
            const scores = matrix[s1.key][s2.key];
            if (s1.key === s2.key) {
                mHTML += `<td><span class="matrix-cell matrix-self">${scores[0]}</span></td>`;
            } else {
                let cellClass = "tie";
                if (scores[0] > scores[1]) cellClass = "win";
                else if (scores[0] < scores[1]) cellClass = "loss";

                mHTML += `<td><span class="matrix-cell ${cellClass}">${scores[0]} - ${scores[1]}</span></td>`;
            }
        });
        mHTML += "</tr>";
    });
    mHTML += "</tbody>";
    matrixTable.innerHTML = mHTML;
    triggerAutoSave();
}

// Initial setup
const storedAutoSave = localStorage.getItem("trust_loop_auto_save");
if (storedAutoSave !== null) {
    isAutoSaveEnabled = (storedAutoSave === "true");
    const checkbox = document.getElementById("auto-save-checkbox");
    if (checkbox) checkbox.checked = isAutoSaveEnabled;
}

loadCustomStrategies();
updateStrategySelects();
renderActiveStrategies();
loadStateFromServer();

// ==================== STATE SYNC & PERSISTENCE LOGIC ====================

function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerText = message;
    container.appendChild(toast);
    
    // Auto remove after 3.3 seconds
    setTimeout(() => {
        toast.remove();
    }, 3300);
}

function collectStateJSON() {
    const payoff_cc = parseInt(document.getElementById("param-cc").value) || 3;
    const payoff_dd = parseInt(document.getElementById("param-dd").value) || 1;
    const payoff_t = parseInt(document.getElementById("param-t").value) || 5;
    const payoff_s = parseInt(document.getElementById("param-s").value) || 0;
    const player1_strategy = document.getElementById("player1-strategy").value;
    const player2_strategy = document.getElementById("player2-strategy").value;
    const tournament_rounds = parseInt(document.getElementById("tournament-rounds").value) || 10;
    
    const custStrats = {};
    for (const key in customStrategies) {
        custStrats[key] = {
            name: customStrategies[key].name,
            codeText: customStrategies[key].codeText,
            description: customStrategies[key].description
        };
    }

    const historyTableBody = document.querySelector("#history-table tbody");
    const gameHistoryHTML = historyTableBody ? historyTableBody.innerHTML : "";
    const historyCard = document.getElementById("game-history-card");
    const historyVisible = historyCard ? historyCard.style.display !== "none" : false;

    const leaderboardCard = document.getElementById("leaderboard-card");
    const matrixCard = document.getElementById("matrix-card");
    const leaderboardVisible = leaderboardCard ? leaderboardCard.style.display !== "none" : false;
    const matrixVisible = matrixCard ? matrixCard.style.display !== "none" : false;

    const leaderboardBody = document.querySelector("#leaderboard-table tbody");
    const leaderboardHTML = leaderboardBody ? leaderboardBody.innerHTML : "";
    const matrixTable = document.getElementById("matrix-table");
    const matrixHTML = matrixTable ? matrixTable.innerHTML : "";

    return {
        settings: {
            payoff_cc: payoff_cc,
            payoff_dd: payoff_dd,
            payoff_t: payoff_t,
            payoff_s: payoff_s,
            player1_strategy: player1_strategy,
            player2_strategy: player2_strategy,
            max_rounds: maxRounds,
            tournament_rounds: tournament_rounds
        },
        custom_strategies: custStrats,
        game_history: {
            player_score: playerScore,
            ai_score: aiScore,
            round: round,
            player_history: playerHistory,
            ai_history: aiHistory,
            last_result_message: document.getElementById("result").innerText,
            history_visible: historyVisible,
            history_html: gameHistoryHTML
        },
        tournament_history: {
            leaderboard_visible: leaderboardVisible,
            matrix_visible: matrixVisible,
            leaderboard_html: leaderboardHTML,
            matrix_html: matrixHTML
        }
    };
}

function applyStateJSON(state) {
    if (!state) return;
    isLoadingState = true;

    try {
        // 1. Load Settings
        if (state.settings) {
            const settings = state.settings;
            if (settings.payoff_cc !== undefined) {
                document.getElementById("param-cc").value = settings.payoff_cc;
                document.getElementById("banner-cc").value = settings.payoff_cc;
            }
            if (settings.payoff_dd !== undefined) {
                document.getElementById("param-dd").value = settings.payoff_dd;
                document.getElementById("banner-dd").value = settings.payoff_dd;
            }
            if (settings.payoff_t !== undefined) {
                document.getElementById("param-t").value = settings.payoff_t;
                document.getElementById("param-t-coop").value = settings.payoff_t;
                document.getElementById("banner-t").value = settings.payoff_t;
            }
            if (settings.payoff_s !== undefined) {
                document.getElementById("param-s").value = settings.payoff_s;
                document.getElementById("param-s-coop").value = settings.payoff_s;
                document.getElementById("banner-s").value = settings.payoff_s;
            }
            if (settings.max_rounds !== undefined) {
                maxRounds = settings.max_rounds;
            }
            if (settings.tournament_rounds !== undefined) {
                document.getElementById("tournament-rounds").value = settings.tournament_rounds;
            }
        }

        // 2. Load Custom Strategies (Python code — no client-side Function needed)
        if (state.custom_strategies) {
            customStrategies = {};
            for (const key in state.custom_strategies) {
                const item = state.custom_strategies[key];
                customStrategies[key] = {
                    name: item.name,
                    type: "custom",
                    description: item.description || "User defined strategy",
                    codeText: item.codeText
                };
            }
            saveCustomStrategiesToStorage();
            updateStrategySelects();
            renderActiveStrategies();
        }

        // Load strategy selections (must load after custom strategies are populated)
        if (state.settings) {
            const settings = state.settings;
            if (settings.player1_strategy !== undefined) {
                document.getElementById("player1-strategy").value = settings.player1_strategy;
            }
            if (settings.player2_strategy !== undefined) {
                document.getElementById("player2-strategy").value = settings.player2_strategy;
            }
            handleStrategyChange();
        }

        // 3. Load Game History
        if (state.game_history) {
            const gh = state.game_history;
            playerScore = gh.player_score || 0;
            aiScore = gh.ai_score || 0;
            round = gh.round || 1;
            playerHistory = gh.player_history || [];
            aiHistory = gh.ai_history || [];

            document.getElementById("player-score").innerText = playerScore;
            document.getElementById("ai-score").innerText = aiScore;
            
            if (round <= maxRounds) {
                document.getElementById("round").innerText = round;
            } else {
                document.getElementById("round").innerText = maxRounds;
            }

            if (gh.last_result_message !== undefined) {
                document.getElementById("result").innerText = gh.last_result_message;
            }

            const historyCard = document.getElementById("game-history-card");
            const historyTableBody = document.querySelector("#history-table tbody");
            if (historyCard && historyTableBody) {
                if (gh.history_visible && gh.history_html) {
                    historyCard.style.display = "block";
                    historyTableBody.innerHTML = gh.history_html;
                } else {
                    historyCard.style.display = "none";
                    historyTableBody.innerHTML = "";
                }
            }
        }

        // 4. Load Tournament History
        if (state.tournament_history) {
            const th = state.tournament_history;
            const leaderboardCard = document.getElementById("leaderboard-card");
            const matrixCard = document.getElementById("matrix-card");
            const leaderboardBody = document.querySelector("#leaderboard-table tbody");
            const matrixTable = document.getElementById("matrix-table");

            if (leaderboardCard && leaderboardBody) {
                if (th.leaderboard_visible && th.leaderboard_html) {
                    leaderboardCard.style.display = "block";
                    leaderboardBody.innerHTML = th.leaderboard_html;
                } else {
                    leaderboardCard.style.display = "none";
                    leaderboardBody.innerHTML = "";
                }
            }

            if (matrixCard && matrixTable) {
                if (th.matrix_visible && th.matrix_html) {
                    matrixCard.style.display = "block";
                    matrixTable.innerHTML = th.matrix_html;
                } else {
                    matrixCard.style.display = "none";
                    matrixTable.innerHTML = "";
                }
            }
        }
    } catch (e) {
        console.error("Error applying state:", e);
        showToast("Error loading state data: " + e.message, "error");
    } finally {
        isLoadingState = false;
    }
}

async function saveStateToServer(silent = false) {
    const payload = collectStateJSON();
    const dot = document.getElementById("sync-indicator");
    const statusText = document.getElementById("sync-status-text");

    try {
        const response = await fetch("/api/state", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (response.ok && data.status === "success") {
            if (dot && statusText) {
                dot.className = "status-dot green";
                statusText.innerText = "Synced";
            }
            if (!silent) {
                showToast("State saved to server!", "success");
            }
        } else {
            throw new Error(data.message || "Failed to save state.");
        }
    } catch (err) {
        console.error("Error saving to server:", err);
        if (dot && statusText) {
            dot.className = "status-dot red";
            statusText.innerText = "Sync Error";
        }
        if (!silent) {
            showToast("Failed to save to server: " + err.message, "error");
        }
    }
}

async function loadStateFromServer() {
    const dot = document.getElementById("sync-indicator");
    const statusText = document.getElementById("sync-status-text");
    if (dot && statusText) {
        dot.className = "status-dot orange";
        statusText.innerText = "Loading...";
    }

    try {
        const response = await fetch("/api/state");
        if (!response.ok) {
            throw new Error("HTTP error " + response.status);
        }
        const data = await response.json();
        applyStateJSON(data);

        if (dot && statusText) {
            dot.className = "status-dot green";
            statusText.innerText = "Synced";
        }
        showToast("State loaded from server!", "success");
    } catch (err) {
        console.error("Error loading from server:", err);
        if (dot && statusText) {
            dot.className = "status-dot red";
            statusText.innerText = "Sync Error";
        }
        showToast("Failed to load state: " + err.message, "error");
    }
}

function exportStateAsFile() {
    try {
        const payload = collectStateJSON();
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
        const downloadAnchor = document.createElement("a");
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", "trust_loop_state.json");
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast("Exported trust_loop_state.json successfully!", "success");
    } catch (err) {
        console.error("Error exporting file:", err);
        showToast("Export failed: " + err.message, "error");
    }
}

function triggerImportFile() {
    const fileInput = document.getElementById("import-file-input");
    if (fileInput) {
        fileInput.click();
    }
}

function importStateFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsed = JSON.parse(e.target.result);
            applyStateJSON(parsed);
            showToast("Imported settings and strategies successfully!", "success");
            
            triggerAutoSave();
        } catch (err) {
            console.error("Error parsing JSON:", err);
            showToast("Failed to import: Invalid JSON file.", "error");
        }
        event.target.value = "";
    };
    reader.readAsText(file);
}

function toggleAutoSave() {
    isAutoSaveEnabled = document.getElementById("auto-save-checkbox").checked;
    localStorage.setItem("trust_loop_auto_save", isAutoSaveEnabled ? "true" : "false");
    showToast(isAutoSaveEnabled ? "Auto-Save to Server Enabled" : "Auto-Save to Server Disabled", "info");
    if (isAutoSaveEnabled) {
        triggerAutoSave();
    }
}

function triggerAutoSave() {
    if (isLoadingState) return;
    const dot = document.getElementById("sync-indicator");
    const statusText = document.getElementById("sync-status-text");

    if (isAutoSaveEnabled) {
        if (dot && statusText) {
            dot.className = "status-dot orange";
            statusText.innerText = "Saving...";
        }
        saveStateToServer(true);
    } else {
        if (dot && statusText) {
            dot.className = "status-dot orange";
            statusText.innerText = "Local changes";
        }
    }
}