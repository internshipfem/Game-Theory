// Base URL prefix for all API calls (matches the Flask Blueprint prefix)
const BASE_URL = "/game";

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
let noiseLevel = 0; // Trembling Hand noise percentage (0-100)

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
let selectedTournamentStrategies = {};

function isStrategySelected(key) {
    if (selectedTournamentStrategies[key] !== undefined) {
        return selectedTournamentStrategies[key];
    }
    const strat = builtInStrategies[key] || customStrategies[key];
    if (strat) {
        return strat.type === "custom";
    }
    return false;
}

function toggleStrategySelection(key, isChecked) {
    selectedTournamentStrategies[key] = isChecked;
    
    // Visually toggle inactive class to avoid full re-render flickering
    const checkboxes = document.querySelectorAll(`input[type="checkbox"]`);
    for (const cb of checkboxes) {
        if (cb.getAttribute('onchange') && cb.getAttribute('onchange').includes(`toggleStrategySelection('${key}'`)) {
            const item = cb.closest('.strategy-item');
            if (item) {
                item.classList.toggle('inactive', !isChecked);
            }
            break;
        }
    }
    
    triggerAutoSave();
}

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

// ==================== NOISE / TREMBLING HAND ====================

/**
 * Apply noise (trembling hand) to a move.
 * With probability noisePercent/100, the move is flipped.
 * @param {string} move - "cooperate" or "betray"
 * @param {number} noisePercent - 0 to 100
 * @returns {{ move: string, trembled: boolean }}
 */
function applyNoise(move, noisePercent) {
    if (noisePercent <= 0) return { move: move, trembled: false };
    if (Math.random() * 100 < noisePercent) {
        const flipped = (move === "cooperate") ? "betray" : "cooperate";
        return { move: flipped, trembled: true };
    }
    return { move: move, trembled: false };
}

/**
 * Sync all noise sliders across Game, Arena, and People screens.
 * Also updates the noise percentage display with color-coded feedback.
 */
function syncNoiseSliders(value) {
    noiseLevel = parseInt(value) || 0;

    const sliderIds = ['game-noise-slider', 'arena-noise-slider', 'people-noise-slider'];
    const valueIds = ['game-noise-value', 'arena-noise-value', 'people-noise-value'];

    sliderIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && parseInt(el.value) !== noiseLevel) el.value = noiseLevel;
    });

    // Determine color class based on noise level
    let colorClass = 'noise-off';
    if (noiseLevel > 0 && noiseLevel <= 30) colorClass = 'noise-low';
    else if (noiseLevel > 30) colorClass = 'noise-high';

    valueIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = noiseLevel + '%';
            el.className = 'noise-value-display ' + colorClass;
        }
    });

    triggerAutoSave();
}

// Helper: execute a Python strategy via the server
async function executePythonStrategy(code, myHistory, opponentHistory) {
    const response = await fetch(BASE_URL + "/api/execute_strategy", {
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

    // Determine Player 1 intended move
    let playerIntended;
    if (p1Strat === "manual") {
        playerIntended = player1ManualChoice;
    } else {
        playerIntended = await getMoveForStrategy(p1Strat, playerHistory, aiHistory, true);
    }

    // Determine Player 2 intended move
    let aiIntended;
    if (p2Strat === "manual") {
        aiIntended = player2ManualChoice;
    } else {
        aiIntended = await getMoveForStrategy(p2Strat, aiHistory, playerHistory, false);
    }

    // Apply noise / trembling hand
    const p1Noise = applyNoise(playerIntended, noiseLevel);
    const p2Noise = applyNoise(aiIntended, noiseLevel);
    const playerMove = p1Noise.move;
    const aiMove = p2Noise.move;
    const p1Trembled = p1Noise.trembled;
    const p2Trembled = p2Noise.trembled;

    const payoff_cc = parseInt(document.getElementById("param-cc").value) || 3;
    const payoff_dd = parseInt(document.getElementById("param-dd").value) || 1;
    const payoff_t = parseInt(document.getElementById("param-t").value) || 5;
    const payoff_s = parseInt(document.getElementById("param-s").value) || 0;

    try {
        const response = await fetch(BASE_URL + "/game_master", {
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

        // Build result text with trembling hand info
        let resultText = `${p1Name} chose ${playerMove}.`;
        if (p1Trembled) resultText += ` ⚡ (intended ${playerIntended}, hand trembled!)`;
        resultText += `\n${p2Name} chose ${aiMove}.`;
        if (p2Trembled) resultText += ` ⚡ (intended ${aiIntended}, hand trembled!)`;
        resultText += `\n\nGame Master: ${data.message}`;
        if (noiseLevel > 0) {
            resultText += `\n🫨 Noise level: ${noiseLevel}%`;
        }
        document.getElementById("result").innerText = resultText;

        // Append to Match History with trembled indicators
        const historyCard = document.getElementById("game-history-card");
        const historyTableBody = document.querySelector("#history-table tbody");
        if (historyCard && historyTableBody) {
            historyCard.style.display = "block";
            const currentRound = playerHistory.length;
            const p1MoveText = playerMove === "cooperate" ? "Cooperate" : "Betray";
            const p2MoveText = aiMove === "cooperate" ? "Cooperate" : "Betray";
            const p1Class = playerMove === "cooperate" ? "cooperate" : "betray";
            const p2Class = aiMove === "cooperate" ? "cooperate" : "betray";

            const p1TrembledBadge = p1Trembled 
                ? `<span class="trembled-badge"><span class="trembled-icon">⚡</span>Trembled</span>` 
                : '';
            const p2TrembledBadge = p2Trembled 
                ? `<span class="trembled-badge"><span class="trembled-icon">⚡</span>Trembled</span>` 
                : '';
            const rowTrembledClass = (p1Trembled || p2Trembled) ? ' class="trembled-row"' : '';

            const rowHTML = `
                <tr${rowTrembledClass}>
                    <td><strong>#${currentRound}</strong></td>
                    <td><span class="move-badge ${p1Class}">${p1MoveText}</span>${p1TrembledBadge}</td>
                    <td><span class="move-badge ${p2Class}">${p2MoveText}</span>${p2TrembledBadge}</td>
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
    const peopleScreen = document.getElementById("people-screen");
    const container = document.querySelector(".game-container");

    const gameTabBtn = document.getElementById("tab-game-btn");
    const arenaTabBtn = document.getElementById("tab-arena-btn");
    const peopleTabBtn = document.getElementById("tab-people-btn");

    // Deactivate all tabs
    gameTabBtn.classList.remove("active");
    arenaTabBtn.classList.remove("active");
    peopleTabBtn.classList.remove("active");

    // Hide all screens
    gameScreen.style.display = "none";
    introScreen.style.display = "none";
    arenaScreen.style.display = "none";
    peopleScreen.style.display = "none";
    container.classList.remove("arena-mode");

    if (tabId === "game") {
        gameTabBtn.classList.add("active");
        const hasStarted = (document.getElementById("intro-screen").style.display === "none" || playerHistory.length > 0 || round > 1);
        if (hasStarted && round > 1) {
            gameScreen.style.display = "block";
        } else {
            introScreen.style.display = "block";
        }
    } else if (tabId === "arena") {
        arenaTabBtn.classList.add("active");
        arenaScreen.style.display = "block";
        container.classList.add("arena-mode");
    } else if (tabId === "people") {
        peopleTabBtn.classList.add("active");
        peopleScreen.style.display = "block";
        container.classList.add("arena-mode");
        populatePeopleStrategyDropdown();
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

// ==================== STRATEGY FILE DROP ZONE ====================

function initStrategyDropzone() {
    const dropzone = document.getElementById("strategy-dropzone");
    if (!dropzone) return;

    // Prevent default browser drag behavior
    ["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    // Visual feedback on drag
    ["dragenter", "dragover"].forEach(eventName => {
        dropzone.addEventListener(eventName, () => {
            dropzone.classList.add("drag-over");
        });
    });

    ["dragleave", "drop"].forEach(eventName => {
        dropzone.addEventListener(eventName, () => {
            dropzone.classList.remove("drag-over");
        });
    });

    // Handle the file drop
    dropzone.addEventListener("drop", (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processStrategyFile(files[0]);
        }
    });
}

function handleStrategyFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        processStrategyFile(file);
    }
}

function processStrategyFile(file) {
    const msgDiv = document.getElementById("strategy-validation-msg");

    // Validate file type
    if (!file.name.endsWith(".py")) {
        msgDiv.className = "validation-msg error";
        msgDiv.innerText = "Only .py (Python) files are accepted.";
        msgDiv.style.display = "block";
        return;
    }

    // Validate file size (max 50KB for safety)
    if (file.size > 50 * 1024) {
        msgDiv.className = "validation-msg error";
        msgDiv.innerText = "File too large. Max size is 50KB.";
        msgDiv.style.display = "block";
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;

        // Populate the code textarea
        const codeArea = document.getElementById("strategy-code");
        codeArea.value = content;

        // Auto-fill name from filename (strip .py, replace underscores)
        const nameInput = document.getElementById("strategy-name");
        if (!nameInput.value.trim()) {
            const baseName = file.name.replace(/\.py$/, "")
                .replace(/[_-]/g, " ")
                .replace(/\b\w/g, c => c.toUpperCase());
            nameInput.value = baseName.substring(0, 20);
        }

        // Reset template selector
        document.getElementById("strategy-template").value = "";

        // Show file info chip
        const fileInfo = document.getElementById("strategy-file-info");
        const fileName = document.getElementById("strategy-file-name");
        fileName.textContent = file.name;
        fileInfo.style.display = "flex";

        // Clear any previous validation message
        msgDiv.className = "validation-msg";
        msgDiv.style.display = "none";

        showToast(`Loaded "${file.name}" — review the code below and save.`, "info");
    };

    reader.onerror = function() {
        msgDiv.className = "validation-msg error";
        msgDiv.innerText = "Failed to read the file. Please try again.";
        msgDiv.style.display = "block";
    };

    reader.readAsText(file);
}

function clearStrategyFile() {
    // Hide file info chip
    const fileInfo = document.getElementById("strategy-file-info");
    fileInfo.style.display = "none";

    // Reset the hidden file input
    const fileInput = document.getElementById("strategy-file-input");
    fileInput.value = "";
}

// Initialize the dropzone event listeners
initStrategyDropzone();

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
        // Validate and save strategy on the server
        msgDiv.innerText = "Validating and saving strategy on server...";
        msgDiv.classList.add("info");
        msgDiv.style.display = "block";

        const response = await fetch(BASE_URL + "/api/custom_strategies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name, codeText: code })
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Failed to save strategy.");
        }

        const newId = result.strategy_id;
        customStrategies[newId] = {
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
        clearStrategyFile();

    } catch (err) {
        msgDiv.className = "validation-msg";
        msgDiv.innerText = "Validation Error: " + err.message;
        msgDiv.classList.add("error");
        msgDiv.style.display = "block";
    }
}

// Strategy Delete logic
async function deleteCustomStrategy(id) {
    if (customStrategies[id]) {
        if (confirm(`Are you sure you want to delete strategy "${customStrategies[id].name}"?`)) {
            try {
                const response = await fetch(BASE_URL + `/api/custom_strategies/${id}`, {
                    method: "DELETE"
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.error || "Failed to delete strategy from server.");
                }
                
                delete customStrategies[id];
                saveCustomStrategiesToStorage();
                updateStrategySelects();
                renderActiveStrategies();
                triggerAutoSave();
                showToast("Strategy deleted successfully.", "success");
            } catch (err) {
                console.error("Error deleting strategy:", err);
                showToast("Failed to delete strategy: " + err.message, "error");
            }
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
        const isChecked = isStrategySelected(key);
        const isInactive = !isChecked;
        html += `
            <div class="strategy-item ${isInactive ? 'inactive' : ''}">
                <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
                    <input type="checkbox" class="strategy-select-checkbox" onchange="toggleStrategySelection('${key}', this.checked)" ${isChecked ? 'checked' : ''}>
                    <div class="strategy-info-box">
                        <span class="strategy-item-name">${strat.name}</span>
                        <span class="strategy-item-badge built-in">Built-in</span>
                        <span class="strategy-item-desc">${strat.description}</span>
                    </div>
                </div>
            </div>
        `;
    }

    for (const key in customStrategies) {
        const strat = customStrategies[key];
        const isChecked = isStrategySelected(key);
        const isInactive = !isChecked;
        html += `
            <div class="strategy-item ${isInactive ? 'inactive' : ''}">
                <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
                    <input type="checkbox" class="strategy-select-checkbox" onchange="toggleStrategySelection('${key}', this.checked)" ${isChecked ? 'checked' : ''}>
                    <div class="strategy-info-box">
                        <span class="strategy-item-name">${strat.name}</span>
                        <span class="strategy-item-badge custom">Custom</span>
                        <span class="strategy-item-desc">User-defined logic</span>
                    </div>
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
        if (isStrategySelected(key)) {
            allStrategies.push({ key: key, ...builtInStrategies[key] });
        }
    }
    for (const key in customStrategies) {
        if (isStrategySelected(key)) {
            allStrategies.push({ key: key, ...customStrategies[key] });
        }
    }

    if (allStrategies.length < 2) {
        showToast("Please select at least 2 strategies to run the tournament.", "error");
        return;
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
    const runningCustom = allStrategies.filter(s => s.type === "custom");
    const hasCustom = runningCustom.length > 0;
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

                // Apply noise / trembling hand to tournament moves
                move1 = applyNoise(move1, noiseLevel).move;
                move2 = applyNoise(move2, noiseLevel).move;

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

// ==================== PEOPLE MODE LOGIC ====================
let peopleRoster = []; // Array of { id, name, strategyKey }

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
loadLocalStateFromStorage();
loadCustomStrategiesFromServer();

const RANDOM_NAMES = [
    "Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank",
    "Ivy", "Jack", "Karen", "Leo", "Mona", "Nate", "Olivia", "Paul",
    "Quinn", "Rosa", "Sam", "Tina", "Uma", "Victor", "Wendy", "Xavier",
    "Yara", "Zane", "Aria", "Blake", "Cleo", "Dex", "Ella", "Finn",
    "Gigi", "Hugo", "Iris", "Jay", "Kira", "Liam", "Mika", "Noah"
];

function populatePeopleStrategyDropdown() {
    const select = document.getElementById("person-strategy");
    if (!select) return;

    const currentVal = select.value;
    let html = '<option value="custom_script">Describe Their Strategy</option>';
    html += '<option disabled>─── Or pick a preset ───</option>';

    for (const key in builtInStrategies) {
        const name = builtInStrategies[key].name;
        const desc = builtInStrategies[key].description;
        html += `<option value="${key}">${name} — ${desc}</option>`;
    }
    for (const key in customStrategies) {
        const name = customStrategies[key].name;
        html += `<option value="${key}">${name} (Custom)</option>`;
    }

    select.innerHTML = html;

    if (Array.from(select.options).some(o => o.value === currentVal)) {
        select.value = currentVal;
    } else {
        select.value = 'custom_script';
    }
    togglePersonScriptEditor();
}

function togglePersonScriptEditor() {
    const select = document.getElementById("person-strategy");
    const editor = document.getElementById("person-script-editor");
    if (!select || !editor) return;

    if (select.value === 'custom_script') {
        editor.style.display = 'block';
        updateStratPreview();
    } else {
        editor.style.display = 'none';
    }
}

// Collect rules from the strategy builder form
function collectRulesFromForm() {
    return {
        defaultMove: document.getElementById('rule-default-move')?.value || 'cooperate',
        switchRound: parseInt(document.getElementById('rule-switch-round')?.value) || 0,
        switchAction: document.getElementById('rule-switch-action')?.value || 'none',
        onBetray: document.getElementById('rule-on-betray')?.value || 'ignore',
        randomPct: parseInt(document.getElementById('rule-random-pct')?.value) || 0
    };
}

// Generate a human-readable summary of the rules
function describeRules(rules) {
    const parts = [];
    const defaultLabel = rules.defaultMove === 'cooperate' ? 'Cooperate' : 'Betray';
    parts.push(`Start: ${defaultLabel}`);

    if (rules.switchRound > 0 && rules.switchAction !== 'none') {
        const actionLabel = {
            switch_cooperate: 'switch to cooperate',
            switch_betray: 'switch to betray',
            alternate: 'alternate moves'
        }[rules.switchAction] || rules.switchAction;
        parts.push(`After round ${rules.switchRound}: ${actionLabel}`);
    }

    if (rules.onBetray !== 'ignore') {
        const betrayLabel = {
            betray_back: 'betray back',
            betray_forever: 'betray forever',
            forgive_once: 'forgive once then betray'
        }[rules.onBetray] || rules.onBetray;
        parts.push(`On betrayal: ${betrayLabel}`);
    }

    if (rules.randomPct > 0) {
        parts.push(`${rules.randomPct}% random betrayal`);
    }

    return parts.join(' • ');
}

// Generate Python code from rules
function rulesToPythonCode(rules) {
    let lines = [];

    // Random chance
    if (rules.randomPct > 0) {
        lines.push(`if random.random() < ${(rules.randomPct / 100).toFixed(2)}:`);
        lines.push(`    return "betray"`);
    }

    // On betrayal reaction (takes priority)
    if (rules.onBetray === 'betray_back') {
        lines.push(`if len(opponent_history) > 0 and opponent_history[-1] == "betray":`);
        lines.push(`    return "betray"`);
    } else if (rules.onBetray === 'betray_forever') {
        lines.push(`if "betray" in opponent_history:`);
        lines.push(`    return "betray"`);
    } else if (rules.onBetray === 'forgive_once') {
        lines.push(`betray_count = opponent_history.count("betray")`);
        lines.push(`if betray_count >= 2:`);
        lines.push(`    return "betray"`);
    }

    // Switch after round N
    if (rules.switchRound > 0 && rules.switchAction !== 'none') {
        lines.push(`if len(my_history) >= ${rules.switchRound}:`);
        if (rules.switchAction === 'switch_cooperate') {
            lines.push(`    return "cooperate"`);
        } else if (rules.switchAction === 'switch_betray') {
            lines.push(`    return "betray"`);
        } else if (rules.switchAction === 'alternate') {
            lines.push(`    return "cooperate" if len(my_history) % 2 == 0 else "betray"`);
        }
    }

    // Default move
    lines.push(`return "${rules.defaultMove}"`);

    return lines.join('\n');
}

// Update the preview text below the form
function updateStratPreview() {
    const previewDiv = document.getElementById('strat-preview');
    if (!previewDiv) return;
    const rules = collectRulesFromForm();
    const summary = describeRules(rules);
    previewDiv.innerHTML = `<span class="preview-label">📝 Strategy:</span> ${summary}`;
}

// Attach live preview listeners
document.addEventListener('DOMContentLoaded', () => {
    ['rule-default-move', 'rule-switch-round', 'rule-switch-action', 'rule-on-betray', 'rule-random-pct'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateStratPreview);
        if (el) el.addEventListener('change', updateStratPreview);
    });
});

function getStrategyDisplayName(stratKey, person) {
    if (stratKey === 'custom_script') {
        if (person && person.rules) {
            return describeRules(person.rules).split(' • ')[0];
        }
        return 'Custom';
    }
    if (builtInStrategies[stratKey]) return builtInStrategies[stratKey].name;
    if (customStrategies[stratKey]) return customStrategies[stratKey].name;
    return stratKey;
}

function addPerson() {
    const nameInput = document.getElementById("person-name");
    const stratSelect = document.getElementById("person-strategy");
    const name = nameInput.value.trim();

    if (!name) {
        showToast("Please enter a name.", "error");
        return;
    }

    if (peopleRoster.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        showToast(`"${name}" is already in the roster.`, "error");
        return;
    }

    const strategyKey = stratSelect.value;
    let rules = null;
    let customCode = null;

    if (strategyKey === 'custom_script') {
        rules = collectRulesFromForm();
        customCode = rulesToPythonCode(rules);
    }

    const person = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: name,
        strategyKey: strategyKey,
        rules: rules,
        customCode: customCode
    };

    peopleRoster.push(person);
    nameInput.value = "";

    // Reset form
    if (strategyKey === 'custom_script') {
        document.getElementById('rule-default-move').value = 'cooperate';
        document.getElementById('rule-switch-round').value = 0;
        document.getElementById('rule-switch-action').value = 'none';
        document.getElementById('rule-on-betray').value = 'ignore';
        document.getElementById('rule-random-pct').value = 0;
        updateStratPreview();
    }

    renderPeopleRoster();
    updatePeopleTournamentButton();
    triggerAutoSave();
    showToast(`Added ${name} with ${getStrategyDisplayName(strategyKey, person)} strategy!`, "success");
}

function addRandomPerson() {
    const usedNames = peopleRoster.map(p => p.name.toLowerCase());
    const availableNames = RANDOM_NAMES.filter(n => !usedNames.includes(n.toLowerCase()));

    if (availableNames.length === 0) {
        showToast("All random names have been used! Enter a name manually.", "error");
        return;
    }

    const randomName = availableNames[Math.floor(Math.random() * availableNames.length)];

    // Pick a random strategy from built-in strategies
    const stratKeys = Object.keys(builtInStrategies);
    const randomStratKey = stratKeys[Math.floor(Math.random() * stratKeys.length)];

    const person = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: randomName,
        strategyKey: randomStratKey
    };

    peopleRoster.push(person);
    renderPeopleRoster();
    updatePeopleTournamentButton();
    triggerAutoSave();
    showToast(`Added ${randomName} with ${getStrategyDisplayName(randomStratKey)} strategy!`, "success");
}

function removePerson(personId) {
    peopleRoster = peopleRoster.filter(p => p.id !== personId);
    renderPeopleRoster();
    updatePeopleTournamentButton();
    triggerAutoSave();
}

function updatePersonStrategy(personId, newStratKey) {
    const person = peopleRoster.find(p => p.id === personId);
    if (person) {
        if (newStratKey === 'custom_script' && !person.rules) {
            person.strategyKey = newStratKey;
            person.rules = { defaultMove: 'cooperate', switchRound: 0, switchAction: 'none', onBetray: 'ignore', randomPct: 0 };
            person.customCode = rulesToPythonCode(person.rules);
            renderPeopleRoster();
        } else {
            person.strategyKey = newStratKey;
            if (newStratKey !== 'custom_script') {
                person.rules = null;
                person.customCode = null;
            }
        }
        triggerAutoSave();
    }
}

function clearAllPeople() {
    if (peopleRoster.length === 0) return;
    if (!confirm("Remove all people from the roster?")) return;
    peopleRoster = [];
    renderPeopleRoster();
    updatePeopleTournamentButton();

    // Hide results
    document.getElementById("people-leaderboard-card").style.display = "none";
    document.getElementById("people-matrix-card").style.display = "none";
    const status = document.getElementById("people-tournament-status");
    if (status) status.style.display = "none";

    triggerAutoSave();
    showToast("Roster cleared.", "info");
}

function renderPeopleRoster() {
    const roster = document.getElementById("people-roster");
    const countBadge = document.getElementById("people-count-badge");
    if (!roster) return;

    countBadge.textContent = peopleRoster.length;

    if (peopleRoster.length === 0) {
        roster.innerHTML = `
            <div class="people-empty-state">
                <span class="empty-icon">👻</span>
                <p>No people added yet.<br>Add some people to get started!</p>
            </div>
        `;
        return;
    }

    // Build strategy options HTML for inline dropdowns
    let stratOptionsHTML = '<option value="custom_script">✍️ Custom Strategy</option>';
    for (const key in builtInStrategies) {
        stratOptionsHTML += `<option value="${key}">${builtInStrategies[key].name}</option>`;
    }
    for (const key in customStrategies) {
        stratOptionsHTML += `<option value="${key}">${customStrategies[key].name} (Custom)</option>`;
    }

    let html = '';
    peopleRoster.forEach((person, index) => {
        const avatarColors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
        const color = avatarColors[index % avatarColors.length];
        const initial = person.name.charAt(0).toUpperCase();
        const isCustom = person.strategyKey === 'custom_script';
        const hasRules = isCustom && person.rules;

        // Generate human-readable summary for custom strategies
        const ruleSummary = hasRules ? describeRules(person.rules) : '';

        html += `
            <div class="person-item ${isCustom ? 'person-item-scripted' : ''}" style="--person-color: ${color}">
                <div class="person-avatar" style="background: ${color}">${initial}</div>
                <div class="person-info">
                    <span class="person-name">${person.name}</span>
                    <div class="person-strat-row">
                        <select class="person-strat-select" onchange="updatePersonStrategy('${person.id}', this.value)">
                            ${stratOptionsHTML.replace(`value="${person.strategyKey}"`, `value="${person.strategyKey}" selected`)}
                        </select>
                    </div>
                    ${hasRules ? `<span class="person-rule-summary">${ruleSummary}</span>` : ''}
                </div>
                <button class="person-remove-btn" onclick="removePerson('${person.id}')" title="Remove">✕</button>
            </div>
        `;
    });

    roster.innerHTML = html;
}

function updatePeopleTournamentButton() {
    const btn = document.getElementById("btn-run-people-tournament");
    if (btn) {
        btn.disabled = peopleRoster.length < 2;
    }
}

async function getMoveForPerson(person, selfHistory, opponentHistory) {
    if (person.strategyKey === 'custom_script' && person.customCode) {
        try {
            const move = await executePythonStrategy(person.customCode, selfHistory, opponentHistory);
            if (move === 'cooperate' || move === 'betray') return move;
        } catch (e) {
            console.error(`Error executing ${person.name}'s custom script`, e);
        }
        return 'cooperate';
    }
    return getMoveForStrategy(person.strategyKey, selfHistory, opponentHistory, true);
}

async function runPeopleTournament() {
    if (peopleRoster.length < 2) {
        showToast("Need at least 2 people to run a tournament.", "error");
        return;
    }

    // Check that all custom_script people have code
    const missingCode = peopleRoster.filter(p => p.strategyKey === 'custom_script' && !p.customCode);
    if (missingCode.length > 0) {
        showToast(`${missingCode.map(p => p.name).join(', ')} need${missingCode.length === 1 ? 's' : ''} a custom script. Click ✍️ to add code.`, "error");
        return;
    }

    const roundCount = parseInt(document.getElementById("people-tournament-rounds").value) || 10;
    const payoff_cc = parseInt(document.getElementById("param-cc").value) || 3;
    const payoff_dd = parseInt(document.getElementById("param-dd").value) || 1;
    const payoff_t = parseInt(document.getElementById("param-t").value) || 5;
    const payoff_s = parseInt(document.getElementById("param-s").value) || 0;

    const statusDiv = document.getElementById("people-tournament-status");
    statusDiv.style.display = "block";
    statusDiv.className = "people-tournament-status running";
    const hasScripts = peopleRoster.some(p => p.strategyKey === 'custom_script');
    statusDiv.innerHTML = `<span class="spinner"></span> Running tournament with ${peopleRoster.length} people over ${roundCount} rounds${hasScripts ? ' (executing scripts...)' : '...'}`;

    const btn = document.getElementById("btn-run-people-tournament");
    btn.disabled = true;

    // Give the UI a tick to render
    await new Promise(r => setTimeout(r, 50));

    const totalScores = {};
    const matrix = {};

    peopleRoster.forEach(p => {
        totalScores[p.id] = 0;
        matrix[p.id] = {};
    });

    try {
        for (let i = 0; i < peopleRoster.length; i++) {
            for (let j = i + 1; j < peopleRoster.length; j++) {
                const p1 = peopleRoster[i];
                const p2 = peopleRoster[j];

                const p1History = [];
                const p2History = [];
                let score1 = 0;
                let score2 = 0;

                for (let r = 0; r < roundCount; r++) {
                    let move1 = "cooperate";
                    let move2 = "cooperate";

                    try {
                        move1 = await getMoveForPerson(p1, p1History, p2History);
                    } catch (e) {
                        console.error(`Error in ${p1.name}'s strategy`, e);
                    }

                    try {
                        move2 = await getMoveForPerson(p2, p2History, p1History);
                    } catch (e) {
                        console.error(`Error in ${p2.name}'s strategy`, e);
                    }

                    if (move1 !== "cooperate" && move1 !== "betray") move1 = "cooperate";
                    if (move2 !== "cooperate" && move2 !== "betray") move2 = "cooperate";

                    // Apply noise / trembling hand to people tournament moves
                    move1 = applyNoise(move1, noiseLevel).move;
                    move2 = applyNoise(move2, noiseLevel).move;

                    p1History.push(move1);
                    p2History.push(move2);

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

                matrix[p1.id][p2.id] = [score1, score2];
                matrix[p2.id][p1.id] = [score2, score1];

                totalScores[p1.id] += score1;
                totalScores[p2.id] += score2;
            }
        }

        // Build ranking
        const numOpponents = peopleRoster.length - 1;
        const ranking = peopleRoster.map(p => {
            const total = totalScores[p.id];
            const avg = (total / (roundCount * numOpponents)).toFixed(2);
            return {
                id: p.id,
                name: p.name,
                strategyKey: p.strategyKey,
                strategyName: getStrategyDisplayName(p.strategyKey, p),
                totalScore: total,
                avgScore: avg
            };
        });
        ranking.sort((a, b) => b.totalScore - a.totalScore);

        // Render leaderboard
        document.getElementById("people-leaderboard-card").style.display = "block";
        const lbBody = document.querySelector("#people-leaderboard-table tbody");
        let lbHTML = '';
        const avatarColors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

        ranking.forEach((item, index) => {
            const rank = index + 1;
            let rankClass = "rank-normal";
            let rankText = rank;
            if (rank === 1) { rankClass = "rank-badge rank-1"; rankText = "1"; }
            else if (rank === 2) { rankClass = "rank-badge rank-2"; rankText = "2"; }
            else if (rank === 3) { rankClass = "rank-badge rank-3"; rankText = "3"; }

            const pIdx = peopleRoster.findIndex(p => p.id === item.id);
            const color = avatarColors[pIdx % avatarColors.length];
            const initial = item.name.charAt(0).toUpperCase();

            const isBuiltIn = builtInStrategies[item.strategyKey];
            const isCustomScript = item.strategyKey === 'custom_script';
            const badgeClass = isCustomScript ? 'custom' : (isBuiltIn ? 'built-in' : 'custom');

            lbHTML += `
                <tr class="${rank <= 3 ? 'top-rank' : ''}">
                    <td><span class="${rankClass}">${rankText}</span></td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="person-avatar-sm" style="background: ${color}">${initial}</span>
                            <strong>${item.name}</strong>
                        </div>
                    </td>
                    <td>
                        <span class="strategy-item-badge ${badgeClass}">${item.strategyName}</span>
                    </td>
                    <td><strong>${item.totalScore}</strong> pts</td>
                    <td>${item.avgScore} pts</td>
                </tr>
            `;
        });
        lbBody.innerHTML = lbHTML;

        // Render matchup matrix
        document.getElementById("people-matrix-card").style.display = "block";
        const matrixTable = document.getElementById("people-matrix-table");

        let mHTML = '<thead><tr><th>Person</th>';
        peopleRoster.forEach(p => {
            mHTML += `<th>${p.name}</th>`;
        });
        mHTML += '</tr></thead><tbody>';

        peopleRoster.forEach(p1 => {
            mHTML += `<tr><td><strong>${p1.name}</strong></td>`;
            peopleRoster.forEach(p2 => {
                if (p1.id === p2.id) {
                    mHTML += `<td><span class="matrix-cell matrix-self">—</span></td>`;
                } else {
                    const scores = matrix[p1.id][p2.id];
                    let cellClass = "tie";
                    if (scores[0] > scores[1]) cellClass = "win";
                    else if (scores[0] < scores[1]) cellClass = "loss";
                    mHTML += `<td><span class="matrix-cell ${cellClass}">${scores[0]} - ${scores[1]}</span></td>`;
                }
            });
            mHTML += '</tr>';
        });
        mHTML += '</tbody>';
        matrixTable.innerHTML = mHTML;

        statusDiv.className = "people-tournament-status done";
        statusDiv.innerHTML = `Tournament complete! ${ranking[0].name} wins with ${ranking[0].totalScore} points using ${ranking[0].strategyName}!`;

        triggerAutoSave();
    } catch (err) {
        console.error("People tournament error:", err);
        statusDiv.className = "people-tournament-status error";
        statusDiv.innerHTML = `Tournament error: ${err.message}`;
    } finally {
        btn.disabled = peopleRoster.length < 2 ? true : false;
    }
}

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
            tournament_rounds: tournament_rounds,
            selected_tournament_strategies: selectedTournamentStrategies,
            noise_level: noiseLevel
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
        },
        people_roster: peopleRoster.map(p => ({
            id: p.id,
            name: p.name,
            strategyKey: p.strategyKey,
            customCode: p.customCode || null
        }))
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
            if (settings.selected_tournament_strategies !== undefined) {
                selectedTournamentStrategies = settings.selected_tournament_strategies;
            }
            if (settings.noise_level !== undefined) {
                syncNoiseSliders(settings.noise_level);
            }
            renderActiveStrategies();
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
        // 5. Load People Roster
        if (state.people_roster && Array.isArray(state.people_roster)) {
            peopleRoster = state.people_roster.map(p => ({
                id: p.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                name: p.name,
                strategyKey: p.strategyKey,
                customCode: p.customCode || null
            }));
            renderPeopleRoster();
            updatePeopleTournamentButton();
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
        const response = await fetch(BASE_URL + "/api/state", {
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
        const response = await fetch(BASE_URL + "/api/state");
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
    showToast(isAutoSaveEnabled ? "Auto-save Enabled" : "Auto-save Disabled", "info");
    if (isAutoSaveEnabled) {
        triggerAutoSave();
    }
}

function triggerAutoSave() {
    if (isLoadingState) return;
    const dot = document.getElementById("sync-indicator");
    const statusText = document.getElementById("sync-status-text");

    if (isAutoSaveEnabled) {
        saveLocalStateToStorage();
        if (dot && statusText) {
            dot.className = "status-dot green";
            statusText.innerText = "Saved locally";
        }
    } else {
        if (dot && statusText) {
            dot.className = "status-dot orange";
            statusText.innerText = "Local changes";
        }
    }
}

function saveLocalStateToStorage() {
    const localState = {
        settings: {
            payoff_cc: parseInt(document.getElementById("param-cc").value) || 3,
            payoff_dd: parseInt(document.getElementById("param-dd").value) || 1,
            payoff_t: parseInt(document.getElementById("param-t").value) || 5,
            payoff_s: parseInt(document.getElementById("param-s").value) || 0,
            player1_strategy: document.getElementById("player1-strategy").value,
            player2_strategy: document.getElementById("player2-strategy").value,
            max_rounds: maxRounds,
            tournament_rounds: parseInt(document.getElementById("tournament-rounds").value) || 10,
            selected_tournament_strategies: selectedTournamentStrategies,
            noise_level: noiseLevel
        },
        game_history: {
            player_score: playerScore,
            ai_score: aiScore,
            round: round,
            player_history: playerHistory,
            ai_history: aiHistory,
            last_result_message: document.getElementById("result").innerText,
            history_visible: document.getElementById("game-history-card")?.style.display !== "none",
            history_html: document.querySelector("#history-table tbody")?.innerHTML || ""
        },
        people_roster: peopleRoster
    };
    localStorage.setItem("trust_loop_local_state", JSON.stringify(localState));
}

function loadLocalStateFromStorage() {
    try {
        const stored = localStorage.getItem("trust_loop_local_state");
        if (stored) {
            const state = JSON.parse(stored);
            
            // Apply settings
            if (state.settings) {
                const s = state.settings;
                if (s.payoff_cc !== undefined) {
                    document.getElementById("param-cc").value = s.payoff_cc;
                    document.getElementById("banner-cc").value = s.payoff_cc;
                }
                if (s.payoff_dd !== undefined) {
                    document.getElementById("param-dd").value = s.payoff_dd;
                    document.getElementById("banner-dd").value = s.payoff_dd;
                }
                if (s.payoff_t !== undefined) {
                    document.getElementById("param-t").value = s.payoff_t;
                    document.getElementById("param-t-coop").value = s.payoff_t;
                    document.getElementById("banner-t").value = s.payoff_t;
                }
                if (s.payoff_s !== undefined) {
                    document.getElementById("param-s").value = s.payoff_s;
                    document.getElementById("param-s-coop").value = s.payoff_s;
                    document.getElementById("banner-s").value = s.payoff_s;
                }
                if (s.max_rounds !== undefined) maxRounds = s.max_rounds;
                if (s.tournament_rounds !== undefined) {
                    document.getElementById("tournament-rounds").value = s.tournament_rounds;
                }
                if (s.player1_strategy !== undefined) {
                    document.getElementById("player1-strategy").value = s.player1_strategy;
                }
                if (s.player2_strategy !== undefined) {
                    document.getElementById("player2-strategy").value = s.player2_strategy;
                }
                if (s.selected_tournament_strategies !== undefined) {
                    selectedTournamentStrategies = s.selected_tournament_strategies;
                }
                if (s.noise_level !== undefined) {
                    syncNoiseSliders(s.noise_level);
                }
                handleStrategyChange();
                renderActiveStrategies();
            }
            
            // Apply game history
            if (state.game_history) {
                const gh = state.game_history;
                playerScore = gh.player_score || 0;
                aiScore = gh.ai_score || 0;
                round = gh.round || 1;
                playerHistory = gh.player_history || [];
                aiHistory = gh.ai_history || [];
                
                document.getElementById("player-score").innerText = playerScore;
                document.getElementById("ai-score").innerText = aiScore;
                document.getElementById("round").innerText = round <= maxRounds ? round : maxRounds;
                if (gh.last_result_message) {
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
                    }
                }
            }
            
            // Apply roster
            if (state.people_roster && Array.isArray(state.people_roster)) {
                peopleRoster = state.people_roster;
                renderPeopleRoster();
                updatePeopleTournamentButton();
            }
        }
    } catch (err) {
        console.error("Error loading local state:", err);
    }
}

async function loadCustomStrategiesFromServer() {
    try {
        const response = await fetch(BASE_URL + "/api/custom_strategies");
        if (!response.ok) {
            throw new Error("HTTP error " + response.status);
        }
        const customStrats = await response.json();
        
        // Apply custom strategies to memory
        customStrategies = {};
        for (const key in customStrats) {
            const item = customStrats[key];
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
        
        // Update dropdowns if we are in People Mode
        populatePeopleStrategyDropdown();
    } catch (err) {
        console.error("Error loading custom strategies from server:", err);
    }
}