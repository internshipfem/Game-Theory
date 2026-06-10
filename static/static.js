let playerScore = 0;
let aiScore = 0;
let round = 1;
let maxRounds = 10;

let playerHistory = [];
let aiHistory = [];
let player1GrudgerAngry = false;
let player2GrudgerAngry = false;
let player1ManualChoice = "cooperate";
let player2ManualChoice = "cooperate";

function getMoveForStrategy(strategy, selfHistory, opponentHistory, isPlayer1) {
    if (strategy === "angel") {
        return "cooperate";
    }

    if (strategy === "snake") {
        return "betray";
    }

    if (strategy === "random") {
        return Math.random() < 0.5 ? "cooperate" : "betray";
    }

    if (strategy === "titfortat") {
        if (opponentHistory.length === 0) {
            return "cooperate";
        }
        return opponentHistory[opponentHistory.length - 1];
    }

    if (strategy === "grudger") {
        if (opponentHistory.includes("betray")) {
            if (isPlayer1) {
                player1GrudgerAngry = true;
            } else {
                player2GrudgerAngry = true;
            }
        }
        const angry = isPlayer1 ? player1GrudgerAngry : player2GrudgerAngry;
        return angry ? "betray" : "cooperate";
    }

    return "cooperate";
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
        playerMove = getMoveForStrategy(p1Strat, playerHistory, aiHistory, true);
    }

    // Determine Player 2 move
    let aiMove;
    if (p2Strat === "manual") {
        aiMove = player2ManualChoice;
    } else {
        aiMove = getMoveForStrategy(p2Strat, aiHistory, playerHistory, false);
    }

    try {
        const response = await fetch("/game_master", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                player_move: playerMove,
                opponent_move: aiMove
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

        round++;

        if (round <= maxRounds) {
            document.getElementById("round").innerText = round;
        } else {
            showFinalResult();
        }
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
    player1GrudgerAngry = false;
    player2GrudgerAngry = false;

    // Reset manual choice active classes
    setManualChoice(1, "cooperate");
    setManualChoice(2, "cooperate");

    document.getElementById("player-score").innerText = 0;
    document.getElementById("ai-score").innerText = 0;
    document.getElementById("round").innerText = 1;
    document.getElementById("result").innerText = "Make your first move.";
}