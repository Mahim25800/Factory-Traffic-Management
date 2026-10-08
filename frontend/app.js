const API_BASE = window.location.origin.includes('http')
  ? `${window.location.origin}/api`
  : 'http://localhost:3000/api';

const currentJunction = 'A';
let pollingTimer = null;
let lastKnownDuplicateId = 'evt-dup-fixed-100';

document.addEventListener('DOMContentLoaded', () => {
  fetchJunctionStatus();
  fetchHistory();

  pollingTimer = setInterval(fetchJunctionStatus, 1200);
  setInterval(fetchHistory, 2500);
});

async function fetchJunctionStatus() {
  try {
    const res = await fetch(`${API_BASE}/junctions/${currentJunction}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    updateDashboardUI(data);
    clearAlert();
  } catch (err) {
    showAlert(`Backend connection lost (${err.message}). Retrying...`);
    const pulse = document.getElementById('connection-pulse');
    if (pulse) pulse.style.backgroundColor = '#ef4444';
  }
}

function updateDashboardUI(data) {
  const pulse = document.getElementById('connection-pulse');
  if (pulse) pulse.style.backgroundColor = '#22c55e';

  const modeBadge = document.getElementById('mode-badge');
  if (modeBadge) {
    modeBadge.textContent = data.mode;
    modeBadge.className = `status-pill mode-pill ${data.mode}`;
  }

  const controllerBadge = document.getElementById('controller-badge');
  if (controllerBadge) {
    controllerBadge.textContent = `CONTROLLER ${data.controller_status}`;
    controllerBadge.className = `status-pill controller-pill ${data.controller_status}`;
  }

  const phaseBadge = document.getElementById('phase-badge');
  if (phaseBadge) {
    phaseBadge.textContent = `Phase: ${data.phase}`;
  }

  const spinner = document.getElementById('transition-spinner');
  if (spinner) {
    if (data.is_transitioning || data.phase === 'ALL_RED') {
      spinner.classList.remove('hidden');
    } else {
      spinner.classList.add('hidden');
    }
  }

  const signals = data.actual_signals || data.desired_signals || {};
  const directions = ['NORTH', 'SOUTH', 'EAST', 'WEST'];

  directions.forEach(dir => {
    const dirLower = dir.toLowerCase();
    const state = signals[dir] || 'RED';

    const r = document.getElementById(`${dirLower}-red`);
    const y = document.getElementById(`${dirLower}-yellow`);
    const g = document.getElementById(`${dirLower}-green`);

    if (r) r.classList.toggle('active', state === 'RED');
    if (y) y.classList.toggle('active', state === 'YELLOW');
    if (g) g.classList.toggle('active', state === 'GREEN');
  });

  const queues = data.queues || { NORTH: 0, SOUTH: 0, EAST: 0, WEST: 0 };
  document.getElementById('queue-north').textContent = `${queues.NORTH || 0} waiting`;
  document.getElementById('queue-south').textContent = `${queues.SOUTH || 0} waiting`;
  document.getElementById('queue-east').textContent = `${queues.EAST || 0} waiting`;
  document.getElementById('queue-west').textContent = `${queues.WEST || 0} waiting`;

  const tbody = document.getElementById('signals-table-body');
  if (tbody) {
    let rowsHtml = '';
    directions.forEach(dir => {
      const desired = (data.desired_signals && data.desired_signals[dir]) || 'UNKNOWN';
      const actual = (data.actual_signals && data.actual_signals[dir]) || 'UNKNOWN';
      const match = desired === actual;
      const syncBadge = match
        ? '<span style="color: #30d158; font-weight: 600;">CONFIRMED</span>'
        : '<span style="color: #ff3b30; font-weight: 700;">MISMATCH</span>';

      rowsHtml += `
        <tr>
          <td><strong>${dir}</strong></td>
          <td><span class="badge-state ${desired}">${desired}</span></td>
          <td><span class="badge-state ${actual}">${actual}</span></td>
          <td>${syncBadge}</td>
        </tr>
      `;
    });
    tbody.innerHTML = rowsHtml;
  }
}

async function fetchHistory() {
  try {
    const res = await fetch(`${API_BASE}/junctions/${currentJunction}/history?limit=25`);
    if (!res.ok) return;

    const data = await res.json();
    const tbody = document.getElementById('audit-table-body');
    if (!tbody || !data.history) return;

    if (data.history.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No events logged yet</td></tr>';
      return;
    }

    tbody.innerHTML = data.history.map(item => {
      const time = new Date(item.timestamp).toLocaleTimeString();
      const detailsStr = item.details ? JSON.stringify(item.details) : '-';
      return `
        <tr>
          <td class="timestamp-col">${time}</td>
          <td><span class="event-type-badge ${item.event_type}">${item.event_type}</span></td>
          <td>${escapeHtml(item.description)}</td>
          <td class="details-col" title="${escapeHtml(detailsStr)}">${escapeHtml(detailsStr)}</td>
        </tr>
      `;
    }).join('');
  } catch (e) {
  }
}

async function requestManual(direction) {
  try {
    const res = await fetch(`${API_BASE}/junctions/${currentJunction}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'MANUAL_GREEN_REQUEST',
        direction: direction
      })
    });
    const data = await res.json();
    if (res.ok) {
      flashNotice(`Manual command accepted: Green requested for ${direction}`);
      fetchJunctionStatus();
      fetchHistory();
    } else {
      showAlert(data.error || 'Failed to request manual green');
    }
  } catch (err) {
    showAlert(`Command error: ${err.message}`);
  }
}

async function returnAutomatic() {
  try {
    const res = await fetch(`${API_BASE}/junctions/${currentJunction}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'RETURN_TO_AUTOMATIC'
      })
    });
    const data = await res.json();
    if (res.ok) {
      flashNotice('Junction returned to AUTOMATIC mode');
      fetchJunctionStatus();
      fetchHistory();
    } else {
      showAlert(data.error || 'Failed to return to automatic');
    }
  } catch (err) {
    showAlert(`Command error: ${err.message}`);
  }
}

async function quickScenario(scenarioType) {
  const now = new Date().toISOString();
  let endpoint = `${API_BASE}/sensor-events`;
  let payload = null;

  switch (scenarioType) {
    case 'TRUCK_NORTH':
      payload = {
        event_id: `evt-truck-${Date.now()}`,
        junction_id: 'A',
        direction: 'NORTH',
        event_type: 'VEHICLE_ARRIVED',
        vehicle_id: `TRK-${Math.floor(100 + Math.random() * 900)}`,
        vehicle_type: 'TRUCK',
        sequence_no: Math.floor(Math.random() * 5000),
        timestamp: now
      };
      break;

    case 'EMERGENCY_EAST':
      payload = {
        event_id: `evt-emg-${Date.now()}`,
        junction_id: 'A',
        direction: 'EAST',
        event_type: 'VEHICLE_ARRIVED',
        vehicle_id: `AMB-${Math.floor(10 + Math.random() * 90)}`,
        vehicle_type: 'EMERGENCY',
        sequence_no: Math.floor(Math.random() * 5000),
        timestamp: now
      };
      break;

    case 'FORKLIFT_WEST':
      payload = {
        event_id: `evt-fork-${Date.now()}`,
        junction_id: 'A',
        direction: 'WEST',
        event_type: 'VEHICLE_ARRIVED',
        vehicle_id: `FL-${Math.floor(10 + Math.random() * 90)}`,
        vehicle_type: 'FORKLIFT',
        sequence_no: Math.floor(Math.random() * 5000),
        timestamp: now
      };
      break;

    case 'DUPLICATE_EVENT':
      // Idempotency demo: Submits exact same event_id twice
      payload = {
        event_id: lastKnownDuplicateId,
        junction_id: 'A',
        direction: 'NORTH',
        event_type: 'VEHICLE_ARRIVED',
        vehicle_id: 'VH-DUP-TEST',
        vehicle_type: 'TRUCK',
        sequence_no: 9999,
        timestamp: now
      };
      break;

    case 'CLEAR_NORTH':
      payload = {
        event_id: `evt-clr-${Date.now()}`,
        junction_id: 'A',
        direction: 'NORTH',
        event_type: 'VEHICLE_CLEARED',
        vehicle_id: 'VH-NORTH',
        timestamp: now
      };
      break;

    case 'CONTROLLER_OFFLINE':
      endpoint = `${API_BASE}/controller-events`;
      payload = {
        device_type: 'SIGNAL_CONTROLLER',
        junction_id: 'A',
        status: 'OFFLINE',
        timestamp: now
      };
      break;

    case 'CONTROLLER_ONLINE':
      endpoint = `${API_BASE}/controller-events`;
      payload = {
        device_type: 'SIGNAL_CONTROLLER',
        junction_id: 'A',
        status: 'ONLINE',
        timestamp: now
      };
      break;
  }

  if (payload) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        const msg = data.duplicate
          ? `[Idempotent] Duplicate event ${payload.event_id} safely rejected`
          : (data.message || 'Scenario executed successfully');
        flashNotice(msg);
        fetchJunctionStatus();
        fetchHistory();
      } else {
        showAlert(data.error || 'Scenario request failed');
      }
    } catch (err) {
      showAlert(`Network error: ${err.message}`);
    }
  }
}

async function submitCustomSensor(eventType) {
  const direction = document.getElementById('sensor-direction').value;
  const vehicleType = document.getElementById('sensor-vehicle-type').value;
  const vehicleId = document.getElementById('sensor-vehicle-id').value.trim() || `VH-${Date.now()}`;

  const payload = {
    event_id: `evt-custom-${Date.now()}`,
    junction_id: 'A',
    direction: direction,
    event_type: eventType,
    vehicle_id: vehicleId,
    vehicle_type: vehicleType,
    timestamp: new Date().toISOString()
  };

  try {
    const res = await fetch(`${API_BASE}/sensor-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      flashNotice(data.message || `Sensor event ${eventType} sent`);
      fetchJunctionStatus();
      fetchHistory();
    } else {
      showAlert(data.error || 'Failed to submit sensor event');
    }
  } catch (err) {
    showAlert(`Submission error: ${err.message}`);
  }
}

function showAlert(message) {
  const banner = document.getElementById('alert-banner');
  const msgSpan = document.getElementById('alert-message');
  if (banner && msgSpan) {
    msgSpan.textContent = message;
    banner.className = 'alert-banner alert-danger';
    banner.classList.remove('hidden');
  }
}

function clearAlert() {
  const banner = document.getElementById('alert-banner');
  if (banner) {
    banner.classList.add('hidden');
  }
}

function flashNotice(message) {
  const banner = document.getElementById('alert-banner');
  const msgSpan = document.getElementById('alert-message');
  if (banner && msgSpan) {
    msgSpan.textContent = message;
    banner.className = 'alert-banner alert-info';
    banner.classList.remove('hidden');
    setTimeout(() => {
      banner.classList.add('hidden');
    }, 3500);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
