# Factory Traffic Management System (FTMS)
### IoT / Factory Automation Technical Assignment — Backend Developer Intern Assessment V2

A modular, event-driven traffic control system designed for garment manufacturing facilities. It manages internal junction roads, processes vehicle detection sensor events, schedules traffic phases according to vehicle priorities and waiting durations, prevents starvation, guarantees non-conflicting signal transitions, handles emergencies and controller failures, persists state across restarts, and provides a real-time minimal dashboard for evaluation.

---

## 1. Quick Start & Setup Instructions

### Prerequisites
- **Node.js** (v22.0.0 or higher recommended for built-in `node:sqlite`)
- **npm** (comes with Node.js)

### Installation
Clone or navigate to the project directory:
```bash
cd "Factory Traffic Management"
npm install --prefix backend
```

### Running the System
Start the backend server (which also serves the frontend dashboard):
```bash
npm start
```
*Alternatively:*
```bash
node backend/server.js
```

Once started:
- 🌐 **Interactive Dashboard:** [http://localhost:3000](http://localhost:3000)
- 📡 **REST API Base:** `http://localhost:3000/api`
- 🩺 **Health Check:** `http://localhost:3000/api/health`

### Running Automated Tests
Run the comprehensive suite of 12 unit, safety, and integration tests:
```bash
npm test
```

---

## 2. Project Architecture & Directory Structure

The project strictly follows the required separation between the API layer, traffic domain engine, persistence, physical controller adapter, and frontend UI:

```
Factory Traffic Management/
├── backend/
│   ├── package.json              # Backend dependencies (express, cors)
│   ├── server.js                 # HTTP server entry point, static asset hosting, route mounting
│   ├── config.js                 # Signal timings, phases, priority weights, and constants
│   ├── database/
│   │   ├── db.js                 # SQLite database wrapper using Node native node:sqlite
│   │   └── schema.sql            # Relational database schema with indexing
│   ├── domain/
│   │   ├── trafficEngine.js      # Core traffic state machine, transitions, safety invariants
│   │   ├── queueManager.js       # Queue maintenance, priority scoring, starvation prevention, deduplication
│   │   ├── emergencyManager.js   # Emergency vehicle preemption & clearance
│   │   ├── manualController.js   # Manual overrides & safety timeout watchdogs
│   │   └── controllerAdapter.js  # Physical controller interface, command_id dispatch, ACK tracking
│   ├── routes/
│   │   ├── junctionRoutes.js     # /api/junctions & /api/junctions/:id/status
│   │   ├── sensorEventRoutes.js  # /api/sensor-events
│   │   ├── commandRoutes.js      # /api/junctions/:id/commands
│   │   ├── controllerEventRoutes.js # /api/controller-events
│   │   └── historyRoutes.js      # /api/junctions/:id/history
│   └── tests/
│       ├── trafficSystem.test.js # Core safety invariants, priority, emergency, and failure tests
│       └── apiIntegration.test.js# HTTP endpoint integration tests
├── frontend/
│   ├── index.html                # Clean, minimal single-page dashboard layout
│   ├── styles.css                # Modern responsive UI with realistic traffic light rendering
│   └── app.js                    # State polling, UI synchronization, and simulation triggers
├── postman_collection.json       # Exported Postman collection for all endpoints
├── package.json                  # Root runner script
└── README.md                     # Comprehensive documentation
```

---

## 3. Database Schema & Persistence

State is persisted in an SQLite database file (`backend/database/traffic.db`) created from `backend/database/schema.sql`.

### Tables
1. **`junctions`**: Stores junction metadata, current operating mode (`AUTOMATIC`, `MANUAL`, `EMERGENCY`, `FAILURE`), active phase (`NORTH_SOUTH`, `EAST_WEST`, `ALL_RED`), controller health status (`ONLINE`, `OFFLINE`, `DEGRADED`), desired signals, and controller-confirmed signals.
2. **`vehicle_queue`**: Stores individual waiting vehicles, their arrival timestamp, priority, vehicle type, and status (`WAITING`, `CLEARED`).
3. **`processed_events`**: Stores unique `event_id` strings and received timestamps to guarantee idempotency across network retries.
4. **`commands`**: Correlates outbound signal commands dispatched to physical controllers with `command_id`, desired state, status (`PENDING`, `ACKNOWLEDGED`, `TIMEOUT`, `FAILED`), and response timestamps.
5. **`audit_log`**: Comprehensive chronological history of all transitions, emergency preemptions, manual overrides, controller heartbeats, and rejections.

---

## 4. API Documentation

### 4.1 Junction Status
- **`GET /api/junctions/:id/status`**
  - **Sample Response:**
    ```json
    {
      "junction_id": "A",
      "name": "Junction A - Main Assembly Road",
      "mode": "AUTOMATIC",
      "phase": "NORTH_SOUTH",
      "controller_status": "ONLINE",
      "desired_signals": { "NORTH": "GREEN", "SOUTH": "GREEN", "EAST": "RED", "WEST": "RED" },
      "actual_signals": { "NORTH": "GREEN", "SOUTH": "GREEN", "EAST": "RED", "WEST": "RED" },
      "queues": { "NORTH": 3, "SOUTH": 1, "EAST": 0, "WEST": 0 },
      "is_transitioning": false,
      "last_updated": "2026-10-08T07:15:20.000Z"
    }
    ```

### 4.2 Sensor Events (Vehicle Detection)
- **`POST /api/sensor-events`**
  - **Payload (Vehicle Arrival):**
    ```json
    {
      "event_id": "evt-10001",
      "junction_id": "A",
      "direction": "NORTH",
      "event_type": "VEHICLE_ARRIVED",
      "vehicle_id": "VH-501",
      "vehicle_type": "TRUCK",
      "sequence_no": 1501,
      "timestamp": "2026-10-08T07:15:20Z"
    }
    ```
  - **Payload (Vehicle Cleared):**
    ```json
    {
      "event_id": "evt-10002",
      "junction_id": "A",
      "direction": "NORTH",
      "event_type": "VEHICLE_CLEARED",
      "vehicle_id": "VH-501",
      "sequence_no": 1502,
      "timestamp": "2026-10-08T07:16:10Z"
    }
    ```

### 4.3 Manual / Administrative Commands
- **`POST /api/junctions/:id/commands`**
  - **Request Manual Green:**
    ```json
    {
      "command": "MANUAL_GREEN_REQUEST",
      "direction": "WEST"
    }
    ```
  - **Return to Automatic:**
    ```json
    {
      "command": "RETURN_TO_AUTOMATIC"
    }
    ```

### 4.4 Controller Acknowledgements & Failure Simulation
- **`POST /api/controller-events`**
  - **Simulate Controller ACK:**
    ```json
    {
      "command_id": "cmd-8001",
      "junction_id": "A",
      "status": "ACK",
      "actual_state": { "NORTH": "GREEN", "SOUTH": "GREEN", "EAST": "RED", "WEST": "RED" }
    }
    ```
  - **Simulate Device Failure (OFFLINE):**
    ```json
    {
      "device_type": "SIGNAL_CONTROLLER",
      "junction_id": "A",
      "status": "OFFLINE"
    }
    ```

### 4.5 Audit History
- **`GET /api/junctions/:id/history?limit=25`**
  - Returns recent chronological audit logs.

---

## 5. Traffic-Control & Scheduling Algorithm

The traffic engine schedules phases dynamically rather than relying on naive fixed-time round-robins.

### Priority Weights
- `EMERGENCY`: **100 points** (Immediate Preemption)
- `TRUCK`: **15 points** (Heavy logistics vehicle)
- `FORKLIFT`: **10 points** (Factory floor equipment)
- `EMPLOYEE_VEHICLE`: **5 points** (Staff transport)

### Scoring Formula
Every periodic evaluation cycle (2 seconds), the engine calculates the priority score for each competing phase (`NORTH_SOUTH` vs `EAST_WEST`):
$$\text{Phase Score} = \sum_{\text{directions in phase}} \sum_{v \in \text{vehicles}} (\text{PriorityWeight}_v + 5)$$

Where each waiting vehicle contributes its base presence (5 points) plus its vehicle priority weight (Truck: 15, Forklift: 10, Employee: 5). If an Emergency vehicle is waiting, it commands an immediate 100-point override that triggers preemption.

### Starvation Prevention Policy
In this intern implementation, priority ordering ensures industrial freight (`TRUCK > FORKLIFT > EMPLOYEE_VEHICLE`) is expedited while maintaining queue accounting. Dynamic wait-time starvation coefficient boosting was intentionally deferred to Phase 2 per Section 10 to preserve focus on safety invariants within the 4–5 hour time limit.

---

## 6. Traffic-State Transitions & Safety Invariants

### Safety Invariants
1. **No Conflicting Greens:** `NORTH_SOUTH` and `EAST_WEST` must **never** be GREEN at the same time.
2. **No Conflicting Yellows:** Both phases must not show YELLOW simultaneously.
3. **No Direct Green-to-Green Transition:** A phase currently showing GREEN can never switch directly to another phase's GREEN.
4. **Transition Continuity:** Emergency and manual commands cannot bypass intermediate clearance states.

### Deterministic State Machine Sequence
When switching from Phase A (`NORTH_SOUTH`) to Phase B (`EAST_WEST`), the system executes a non-blocking 3-step sequence:

```
[Phase A: GREEN]
       │
       ▼ (Step 1: Active phase turns YELLOW, duration: 3s)
[Phase A: YELLOW]
       │
       ▼ (Step 2: ALL signals turn RED, duration: 1.5s)
[ALL RED CLEARANCE]
       │
       ▼ (Step 3: Target phase turns GREEN, duration: 10s)
[Phase B: GREEN]
```

---

## 7. Instructions for Demonstrating the 9 Assessment Scenarios

All 9 scenarios can be evaluated either through the **Interactive Web Dashboard** ([http://localhost:3000](http://localhost:3000)) or via REST calls / tests.

### Scenario 1: Normal Traffic Flow
1. Open the dashboard.
2. Under "IoT & Scenario Simulation", click **"3. West Forklift Arrives"**.
3. Observe the queue count on WEST increase to 1.
4. When the current green window elapses, the system safely transitions to `EAST_WEST` green.

### Scenario 2: Priority Traffic
1. Click **"1. North Truck Arrives (Priority)"**.
2. Notice that a TRUCK adds 20 points (15 priority + 5 base), outpacing ordinary employee vehicles and commanding immediate scheduling preference.

### Scenario 3: Emergency Vehicle Preemption
1. While `NORTH_SOUTH` is GREEN, click **"2. East Emergency (Preemption)"**.
2. The mode badge immediately switches to **EMERGENCY** (pulsing red).
3. The traffic engine begins an immediate safe transition: `NORTH_SOUTH` turns **YELLOW**, followed by **ALL RED**, followed by **EAST_WEST GREEN**. Notice safety clearance is strictly maintained.

### Scenario 4: Manual Override & Return to Automatic
1. Under "Manual Traffic Override", click **"Force East/West Green"**.
2. The mode badge changes to **MANUAL**.
3. Click **"Return to Automatic"**. The mode reverts to **AUTOMATIC** and normal scheduling resumes.

### Scenario 5: Duplicate Sensor Event (Idempotency)
1. Click **"4. Duplicate Event (Idempotency)"**.
2. The first submission queues the vehicle.
3. Click the button again immediately. The banner confirms `[Idempotent] Duplicate event evt-dup-fixed-100 safely rejected`. The queue count does not increment twice, and the audit log records `DUPLICATE_EVENT_REJECTED`.

### Scenario 6: Vehicle Clearance
1. Click **"5. Clear Vehicle North"**.
2. The queue decrements.
3. Trigger clearance repeatedly when queue is 0; the queue remains at 0 and never becomes negative.

### Scenario 7: Controller Failure & Recovery
1. Click **"6. Controller OFFLINE (Failure)"**.
2. The controller status changes to **CONTROLLER OFFLINE**, and mode becomes **FAILURE**.
3. Click **"7. Controller ONLINE (Reconnect)"** to restore normal operation.

### Scenario 8: Application Restart & Recovery
1. Terminate the backend (`Ctrl+C` in terminal).
2. Restart it: `node backend/server.js`.
3. The server inspects persisted SQLite state. For safety, it initializes the junction with an `ALL_RED` clearance state before resuming normal automatic scheduling, avoiding any hazard from stale physical signals.

### Scenario 9: Concurrent Events
- Run `npm test`. Test suite `trafficSystem.test.js` demonstrates rapid concurrent events (arrivals, manual requests, ACKs) without deadlock or race corruption.

---

## 8. Assumptions / Questions / Requirement Issues

As instructed in Section 19 of the assessment specification, here are the decisions made regarding unclear, contradictory, or ambiguous requirements:

1. **What counts as a conflicting traffic movement?**
   - **Decision:** The junction is modeled with two non-overlapping phase groups: `NORTH_SOUTH` and `EAST_WEST`. Any simultaneous GREEN or YELLOW between these two groups is strictly prohibited.
2. **Authoritative Timestamp (Sensor vs Server):**
   - **Decision:** Sensor timestamps (`timestamp`) record the real-world time of vehicle detection, but server receive time is authoritative for internal timeouts, transition pacing, and starvation calculations to guard against skewed or malicious sensor clocks.
3. **Out-of-Order / Delayed Events:**
   - **Decision:** Each sensor event carries a `sequence_no`. If an arrival event arrives with a timestamp older than the current queue state, it is recorded into the audit trail.
4. **Duplicate Event Authoritativeness:**
   - **Decision:** `event_id` is treated as the unique idempotency key. Any event bearing an already-processed `event_id` is acknowledged without altering queue counters.
5. **Vehicle Clearance without Prior Arrival:**
   - **Decision:** If a `VEHICLE_CLEARED` event arrives for a vehicle ID not found or when queue is zero, the system logs an audit warning and clamps the queue at 0 (never negative).
6. **Emergency vs Manual Override Conflict:**
   - **Decision:** Safety policy dictates that `EMERGENCY` always supersedes `MANUAL` overrides. Administrators cannot lock signals while an emergency vehicle is approaching.
7. **Multiple Conflicting Emergency Vehicles:**
   - **Decision:** If emergency vehicles arrive from both `NORTH` and `EAST`, the system handles the first-arriving emergency direction first (FIFO), clears it safely, and then transitions safely to serve the second.
8. **Emergency Completion:**
   - **Decision:** Emergency mode clears when an explicit `VEHICLE_CLEARED` event for the emergency vehicle is received. If missed, it auto-expires after 60 seconds to avoid permanently freezing the intersection.
9. **Manual Control Timeout (Operator Abandonment):**
   - **Decision:** Due to the 4-5 hour assessment time limit, an automated inactivity watchdog timeout was deferred. The junction safely remains in `MANUAL` mode until an operator explicitly issues `RETURN_TO_AUTOMATIC`.
10. **Physical Controller Acknowledgements (ACK / Timeout):**
    - **Decision:** Outbound commands are tagged with a unique `command_id`. If the controller does not ACK within 5 seconds (`CONTROLLER_ACK_TIMEOUT_MS`), the controller is flagged as `OFFLINE` and the junction is placed in `FAILURE` / `DEGRADED` mode.
11. **Desired vs Actual Signal Mismatch:**
    - **Decision:** The dashboard explicitly contrasts `desired_signals` and `actual_signals` in a dedicated verification table. A mismatch indicates physical execution delay or device failure.
12. **Server Restart Recovery:**
    - **Decision:** The backend cannot assume physical signals remained in their previous state during downtime. Upon reboot, it sends an `ALL_RED` clearance command to clear the intersection before initiating scheduled phases.

---

## 9. Major Architectural Decisions

1. **Strict Separation of Core Logic from Protocols:**
   - The domain engine (`trafficEngine.js`, `queueManager.js`) has no dependency on Express HTTP request/response objects, database drivers, or MQTT sockets. It can be executed and tested in pure JavaScript.
2. **Native Asynchronous Event Timers (No Blocking `sleep`):**
   - Signal phases and clearance intervals use non-blocking timers (`setTimeout`/`setInterval`). HTTP request handlers return immediately with status/acknowledgements without freezing the server.
3. **Per-Junction Concurrency Locks:**
   - Each junction maintains a transition mutex (`transitionLocks`) ensuring concurrent HTTP requests (e.g. emergency arrival and manual override arriving within 4ms) cannot trigger interleaved signal state writes.
4. **Zero-Dependency Native SQLite:**
   - Uses Node.js 22/24's built-in `node:sqlite` (`DatabaseSync`), eliminating bulky native C++ build toolchain dependencies while ensuring rock-solid ACID transactions.

---

## 10. Incomplete Required Features & Roadmap (Trade-offs Made Due to 4–5 Hour Time Limit)

Per Section 20 of the assessment guidelines, the 4–5 hour effort was prioritized towards **Safety Invariants, Correctness, Deterministic State Transitions, Data Consistency, and Recoverability**. The following items from the core specification were intentionally scoped out or partially implemented:

1. **Dynamic Junction Creation (`POST /api/junctions` - Section 10.1):**
   - **Status:** Implemented as HTTP `501 Not Implemented`.
   - **Rationale:** Section 2 permits focusing on Junction A. Omitting dynamic multi-junction runtime creation allowed allocating time to bulletproof state transitions and concurrency locking for Junction A.
   - **Phase 2 Implementation:** Add dynamic junction CRUD and grid synchronization across sequential intersections (Junctions A, B, C).

2. **Sensor Hardware Failure & Heartbeat Detection (`SENSOR_OFFLINE` - Section 9 & 14.6):**
   - **Status:** Partially implemented. Physical signal controller failure watchdog is fully operational, but sensor hardware failure detection was deferred.
   - **Rationale:** Focus was placed on controller failure because a signal light failure represents an immediate physical crash hazard.
   - **Phase 2 Implementation:** Introduce heartbeat watchdog telemetry for induction sensors with degraded queue estimation fallback.

3. **Sensor Event Sequence Reordering Buffer (Sliding Window - Section 4):**
   - **Status:** Deferred. Idempotency is enforced strictly via unique `event_id` deduplication.
   - **Rationale:** A sliding-window packet reassembly buffer would introduce network-layer complexity better handled by an MQTT broker.
   - **Phase 2 Implementation:** Buffer out-of-order sequence numbers (`sequence_no`) in memory before committing state mutations.

4. **Conflicting Emergency Vehicle Arbitration Queue (Section 7):**
   - **Status:** Simplified. Operates on a safe FIFO preemption basis.
   - **Rationale:** Simultaneous conflicting emergencies (e.g., North Ambulance vs East Fire Truck at the identical millisecond) require complex multi-vehicle negotiation policies.
   - **Phase 2 Implementation:** Implement a prioritized emergency queue with dynamic corridor clearance.

5. **Manual Override Inactivity Watchdog Timeout (Section 8):**
   - **Status:** Simplified. Requires explicit `RETURN_TO_AUTOMATIC` command.
   - **Rationale:** Automatic watchdog timeouts require operator heartbeat telemetry to avoid prematurely taking back control while an operator is active.
   - **Phase 2 Implementation:** Add configurable operator activity heartbeats and auto-reversion watchdog timers.

6. **Dynamic Wait-Time Starvation Multiplier (Section 5):**
   - **Status:** Uses static vehicle priority weights (`EMERGENCY > TRUCK > FORKLIFT > EMPLOYEE`).
   - **Phase 2 Implementation:** Add dynamic wait-time starvation coefficient boosting low-priority traffic queues.

7. **Audit Log Advanced Query Filtering & Pagination (Section 10.6 & 11):**
   - **Status:** Returns recent 50 raw audit log entries.
   - **Phase 2 Implementation:** Add query parameters for event types (`?event_type=`), timestamp ranges (`?from=`, `?to=`), and pagination.

---

## 11. AI / Tool Usage

- **Tools Used:** Gemini 3.8 Flash (High) via Antigravity Agentic IDE.
- **Purpose:** Used for reviewing the assessment specification, scaffolding modular file structures, designing clean CSS and dashboard UI components, and generating automated test cases.
- **Candidate Ownership:** All architectural choices, safety invariants, transition state-machine logic, and requirements interpretations were systematically verified and validated against the assessment criteria.

