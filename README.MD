# Trust Loop

**Trust Loop** is an interactive Prisoner's Dilemma simulator built with Flask, HTML, CSS, and JavaScript. It lets you explore trust, betrayal, and strategy through three distinct game modes — play manually against AI opponents, pit custom Python strategies against each other in a tournament arena, or survey real people and simulate how their strategies perform head-to-head.

## Features

### 🎮 Game Mode
- Play a round-by-round Prisoner's Dilemma (default 10 rounds)
- Choose from **built-in strategies** for both Player 1 and Player 2: Manual, Angel, Snake, Tit for Tat, Random, Grudger
- **Manual control** — cooperate or betray each round with segmented toggle buttons
- **Customisable payoff parameters** — edit CC, DD, T, and S values live during play
- **Match history table** tracking every round's moves and payoffs
- End-of-game results with winner announcement

### ⚔️ Strategy Arena
- **Create custom strategies** by writing Python code directly in the browser
- **Template library** — start from Tit for Two Tats, Alternator, Pavlov, or Majority Cooperator
- **Drag & drop `.py` file upload** — load strategy files from disk
- **Server-side validation** — strategies are tested against 3 scenarios before saving
- **Sandboxed execution** — custom code runs in a restricted Python environment (safe builtins only, `random` module available)
- **Round-robin tournament** — every strategy plays every other strategy (including itself)
- **Leaderboard** with total score and average-per-round rankings
- **Matchup matrix (cross-table)** showing head-to-head scores
- Select/deselect strategies to include in the tournament

### 👥 People Mode
- Add real people by name and assign them a strategy
- Choose from preset strategies or build a custom one with the **Strategy Builder**:
  - Set a default opening move
  - Configure round-based switches (e.g. "after round 5, switch to betray")
  - Respond to opponent betrayals (ignore, betray back, grudge, forgive once)
  - Add random betrayal chance
- Run a **People Tournament** — round-robin between all added people
- View **People Leaderboard** and **Head-to-Head Results** matrix

### 🫨 Noise / Trembling Hand
- Global noise slider (0–100%) shared across all three modes
- Each move has a configurable chance of being randomly flipped
- Simulates real-world mistakes and uncertainty
- Noise events are highlighted in match history with ⚡ indicators

### 💾 Data Sync Center
- **Save / Load** full game state to/from the server (`data.json`)
- **Export / Import** state as a local JSON file
- **Auto-save** to `localStorage` (toggleable)
- Persists settings, payoffs, custom strategies, game history, and tournament results

## Tech Stack

| Layer       | Technology                   |
|-------------|------------------------------|
| Backend     | Python, Flask (Blueprint)    |
| Frontend    | HTML, CSS, JavaScript        |
| Deployment  | Gunicorn, Procfile           |
| Data        | JSON file (`data.json`)      |

## Project Structure

```
Game/
├── app.py              # Flask app with Blueprint, API routes, strategy execution
├── wsgi.py             # WSGI entry point for production (Gunicorn)
├── Procfile            # Heroku / PaaS deployment config
├── requirements.txt    # Python dependencies
├── data.json           # Persistent game state (auto-created)
├── templates/
│   └── index.html      # Single-page app with 3 tabbed modes
└── static/
    ├── static.js       # Game logic, tournament engine, strategy management
    └── style.css       # Dark-themed responsive UI
```

## Setup

### 1. Create a virtual environment

```bash
python -m venv venv
source venv/bin/activate   # Linux / macOS
venv\Scripts\activate      # Windows
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Run locally (development)

```bash
python app.py
```

The app starts at **http://localhost:3000** and redirects `/` → `/game/`.

### 4. Run in production

```bash
gunicorn wsgi:app --bind 0.0.0.0:3000 --workers 4
```

Or deploy to a PaaS that reads the `Procfile`.

## API Endpoints

All routes are served under the `/game` Blueprint prefix.

| Method   | Endpoint                              | Description                                  |
|----------|---------------------------------------|----------------------------------------------|
| `GET`    | `/game/`                              | Serve the single-page app                    |
| `GET`    | `/game/api/state`                     | Retrieve full game state from `data.json`    |
| `POST`   | `/game/api/state`                     | Save full game state to `data.json`          |
| `GET`    | `/game/api/custom_strategies`         | List all custom strategies                   |
| `POST`   | `/game/api/custom_strategies`         | Validate & save a new custom strategy        |
| `DELETE` | `/game/api/custom_strategies/<id>`    | Delete a custom strategy                     |
| `POST`   | `/game/game_master`                   | Score a single round (player + opponent move)|
| `POST`   | `/game/api/execute_strategy`          | Execute a Python strategy for one move       |
| `POST`   | `/game/api/validate_strategy`         | Validate a strategy against 3 test cases     |

## Built-in Strategies

| Strategy    | Behaviour                                              |
|-------------|--------------------------------------------------------|
| Angel       | Always cooperates                                      |
| Snake       | Always betrays                                         |
| Tit for Tat | Cooperates first, then copies opponent's last move     |
| Random      | 50 / 50 cooperate or betray                            |
| Grudger     | Cooperates until betrayed, then betrays forever        |

## Writing a Custom Strategy

Your code receives two lists — `my_history` and `opponent_history` — and must return `"cooperate"` or `"betray"`.

```python
# Example: Suspicious Tit for Tat
if len(opponent_history) == 0:
    return "betray"
return opponent_history[-1]
```

You can also define a full function:

```python
def strategy(my_history, opponent_history):
    if opponent_history.count("betray") > 3:
        return "betray"
    return "cooperate"
```

The `random` module is available. All other imports are blocked for safety.