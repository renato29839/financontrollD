// --- IMPORTAÇÃO DOS SDKs DO FIREBASE ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  onSnapshot,
  query,
  where,
  orderBy,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- CONFIGURAÇÃO DO SEU PROJETO FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyBoOgnYZyv8V2tMRG2YsmoyH_JSw6RQ1IM",
  authDomain: "damarisfinan.firebaseapp.com",
  projectId: "damarisfinan",
  storageBucket: "damarisfinan.firebasestorage.app",
  messagingSenderId: "749964063892",
  appId: "1:749964063892:web:0bce6bf6672157ae193081"
};

// Inicialização
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Coleções no Firestore
const txCollection = collection(db, "transactions");
const cardsCollection = collection(db, "cards");
const budgetsCollection = collection(db, "budgets");

// --- ESTADO GLOBAL DA APLICAÇÃO ---
let activeTab = 'dashboard';
let selectedDate = new Date();
let viewMode = 'month'; 
let privacyMode = false;

let transactions = [];
let cards = [];
let budgets = [];
let unsubscribeTransactions = null;
let renderScheduled = false;

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

const CATEGORY_COLORS = {
  'Alimentação': '#f43f5e',
  'Moradia': '#818cf8',
  'Transporte': '#38bdf8',
  'Lazer': '#fbbf24',
  'Saúde': '#34d399',
  'Trabalho': '#10b981',
  'Outros': '#94a3b8'
};

// --- LISTENERS EM TEMPO REAL COM O FIREBASE ---
function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getPeriodBounds() {
  const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
  const end = new Date(start);
  if (viewMode === 'day') end.setDate(end.getDate() + 1);
  if (viewMode === 'month') {
    start.setDate(1);
    end.setFullYear(start.getFullYear(), start.getMonth() + 1, 1);
  }
  if (viewMode === 'year') {
    start.setMonth(0, 1);
    end.setFullYear(start.getFullYear() + 1, 0, 1);
  }
  return { start: formatDateKey(start), end: formatDateKey(end) };
}

function subscribeTransactionsForPeriod() {
  if (unsubscribeTransactions) unsubscribeTransactions();
  const bounds = getPeriodBounds();
  const periodQuery = query(txCollection, where('date', '>=', bounds.start), where('date', '<', bounds.end), orderBy('date', 'desc'));
  unsubscribeTransactions = onSnapshot(periodQuery, (snapshot) => {
    transactions = snapshot.docs.map(d => ({ docId: d.id, ...d.data() }));
    scheduleRender();
  }, (error) => console.error('Erro ao carregar transações:', error));
}

onSnapshot(cardsCollection, (snapshot) => {
  cards = snapshot.docs.map(d => ({ docId: d.id, ...d.data() }));
  scheduleRender();
});

onSnapshot(budgetsCollection, (snapshot) => {
  budgets = snapshot.docs.map(d => ({ docId: d.id, ...d.data() }));
  scheduleRender();
});

// --- SISTEMA DE DATA E NAVEGAÇÃO ---
window.setViewMode = function(mode) {
  viewMode = mode;
  document.querySelectorAll('.view-mode-selector button').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-mode-${mode}`).classList.add('active');
  subscribeTransactionsForPeriod();
  scheduleRender();
};

window.changeDate = function(delta) {
  if (viewMode === 'day') selectedDate.setDate(selectedDate.getDate() + delta);
  if (viewMode === 'month') selectedDate.setMonth(selectedDate.getMonth() + delta);
  if (viewMode === 'year') selectedDate.setFullYear(selectedDate.getFullYear() + delta);
  subscribeTransactionsForPeriod();
  scheduleRender();
};

function updateDisplay() {
  updateDateDisplayText();
  renderTabContent();
  if (window.lucide) window.lucide.createIcons();
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    updateDisplay();
  });
}

function updateDateDisplayText() {
  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const display = document.getElementById('date-display-text');
  
  if (viewMode === 'day') {
    display.innerText = selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  } else if (viewMode === 'month') {
    display.innerText = `${months[selectedDate.getMonth()]} / ${selectedDate.getFullYear()}`;
  } else {
    display.innerText = selectedDate.getFullYear();
  }
}

window.switchTab = function(tab) {
  activeTab = tab;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`nav-${tab}`).classList.add('active');
  scheduleRender();
};

window.togglePrivacy = function() {
  privacyMode = !privacyMode;
  const btn = document.getElementById('btn-privacy');
  btn.innerHTML = privacyMode ? `<i data-lucide="eye-off"></i>` : `<i data-lucide="eye"></i>`;
  scheduleRender();
};

function formatCurrency(val) {
  if (privacyMode) return 'R$ •••••';
  return currencyFormatter.format(Number(val) || 0);
}

// --- FILTRAGEM ---
function getFilteredTransactions() {
  return transactions;
}

function summarizeTransactions(list) {
  const summary = { income: 0, expensePaid: 0, expensePending: 0, cardsTotal: 0, categories: {}, cards: {} };
  for (const transaction of list) {
    const amount = Number(transaction.amount) || 0;
    if (transaction.type === 'income' && transaction.status === 'paid') summary.income += amount;
    if (transaction.type === 'expense') {
      if (transaction.status === 'paid') summary.expensePaid += amount;
      if (transaction.status === 'pending') summary.expensePending += amount;
      summary.categories[transaction.category] = (summary.categories[transaction.category] || 0) + amount;
    }
    if (transaction.method === 'card') {
      summary.cardsTotal += amount;
      summary.cards[transaction.cardId] = (summary.cards[transaction.cardId] || 0) + amount;
    }
  }
  return summary;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

// --- RENDERIZAÇÃO DE COMPONENTES ---
function renderTabContent() {
  const container = document.getElementById('tab-content');
  if (!container) return;
  const filteredTx = getFilteredTransactions();

  if (activeTab === 'dashboard') {
    const summary = summarizeTransactions(filteredTx);
    const { income, expensePaid, expensePending, cardsTotal, categories: catTotals } = summary;
    const balance = income - expensePaid;

    container.innerHTML = `
      <div class="card balance-card">
        <span style="font-size: 0.78rem; opacity: 0.9;">Saldo Realizado no Período</span>
        <div class="amount">${formatCurrency(balance)}</div>
      </div>

      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-title text-income"><i data-lucide="arrow-up-right" size="14"></i> Receitas</div>
          <div class="stat-value text-income">${formatCurrency(income)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-title text-expense"><i data-lucide="arrow-down-right" size="14"></i> Despesas Pagas</div>
          <div class="stat-value text-expense">${formatCurrency(expensePaid)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-title text-pending"><i data-lucide="clock" size="14"></i> A Pagar (Pendente)</div>
          <div class="stat-value text-pending">${formatCurrency(expensePending)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-title text-card"><i data-lucide="credit-card" size="14"></i> Faturas do Mês</div>
          <div class="stat-value text-card">${formatCurrency(cardsTotal)}</div>
        </div>
      </div>

      <div class="card">
        <h3 style="font-size: 0.85rem; margin-bottom: 8px;">Distribuição de Despesas</h3>
        ${renderCategoryChart(catTotals)}
      </div>
    `;
  }

  else if (activeTab === 'transactions') {
    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="font-size:0.95rem;">Lançamentos (${filteredTx.length})</h3>
        <button class="btn-secondary" onclick="window.openImportModal()"><i data-lucide="file-up" size="14"></i> Importar</button>
      </div>
      <div class="tx-list">
    `;

    if (filteredTx.length === 0) {
      html += `<p style="text-align:center; color:var(--text-muted); margin-top:30px; font-size: 0.85rem;">Nenhuma transação cadastrada no Firebase para este período.</p>`;
    } else {
      filteredTx.forEach(t => {
        const isIncome = t.type === 'income';
        const color = CATEGORY_COLORS[t.category] || '#94a3b8';

        html += `
          <div class="transaction-item">
            <div class="tx-left">
              <div style="width:4px; height:36px; background-color:${color}; border-radius:2px;"></div>
              <div>
                <div class="tx-title">${escapeHTML(t.description)}</div>
                <div class="tx-sub">${t.category} • ${t.date} ${t.installmentsInfo ? `(${t.installmentsInfo})` : ''}</div>
              </div>
            </div>
            <div class="tx-right">
              <div class="tx-title ${isIncome ? 'text-income' : ''}">
                ${isIncome ? '+' : '-'} ${formatCurrency(t.amount)}
              </div>
              <div class="badge-status ${t.status === 'paid' ? 'text-income' : 'text-pending'}" onclick="window.toggleTxStatus('${t.docId}', '${t.status}')" style="cursor:pointer;">
                ${t.status === 'paid' ? 'Quitado' : 'Pendente'}
              </div>
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;
    container.innerHTML = html;
  }

  else if (activeTab === 'cards') {
    const summary = summarizeTransactions(filteredTx);
    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="font-size:0.95rem;">Seus Cartões (Cloud)</h3>
        <button class="btn-primary" onclick="window.openAddCardPrompt()" style="padding: 6px 12px; font-size:0.75rem;">+ Cartão</button>
      </div>
    `;

    cards.forEach(card => {
      const cardExpenses = summary.cards[card.id] || 0;

      const pct = Math.min(100, Math.round((cardExpenses / card.limit) * 100));

      html += `
        <div class="card" style="background: linear-gradient(135deg, #1e1b4b, #312e81);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
            <div>
              <strong style="font-size:1.05rem;">${escapeHTML(card.name)}</strong>
              <div style="font-size:0.72rem; color:#c7d2fe;">Fecha dia ${card.closingDay} • Vence dia ${card.dueDay}</div>
            </div>
            <i data-lucide="credit-card" class="text-card"></i>
          </div>

          <div style="margin-top:12px;">
            <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:4px;">
              <span>Fatura Utilizada: <strong>${formatCurrency(cardExpenses)}</strong></span>
              <span>Limite: ${formatCurrency(card.limit)}</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${pct}%; background-color: ${pct > 80 ? 'var(--rose)' : 'var(--indigo)'}"></div>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  else if (activeTab === 'budgets') {
    const summary = summarizeTransactions(filteredTx);
    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="font-size:0.95rem;">Tetos de Gastos</h3>
        <button class="btn-primary" onclick="window.openAddBudgetPrompt()" style="padding: 6px 12px; font-size:0.75rem;">+ Definir Teto</button>
      </div>
    `;

    budgets.forEach(b => {
      const spent = summary.categories[b.category] || 0;

      const pct = Math.min(100, Math.round((spent / b.limit) * 100));
      let color = 'var(--emerald)';
      if (pct > 75) color = 'var(--amber)';
      if (pct >= 100) color = 'var(--rose)';

      html += `
        <div class="card">
          <div style="display:flex; justify-content:space-between; font-size:0.85rem; font-weight:700; margin-bottom:6px;">
            <span>${escapeHTML(b.category)}</span>
            <span style="color:${color}">${pct}%</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-muted); margin-bottom:6px;">
            <span>Gasto: ${formatCurrency(spent)}</span>
            <span>Limite: ${formatCurrency(b.limit)}</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width:${pct}%; background-color:${color}"></div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  else if (activeTab === 'projection') {
    const fixedIn = transactions.filter(t => t.type === 'income' && t.recurrence === 'fixed').reduce((a, b) => a + b.amount, 0);
    const fixedOut = transactions.filter(t => t.type === 'expense' && t.recurrence === 'fixed').reduce((a, b) => a + b.amount, 0);
    const projBalance = fixedIn - fixedOut;

    container.innerHTML = `
      <div class="card" style="background: linear-gradient(135deg, #064e3b, #047857);">
        <span style="font-size:0.78rem; opacity:0.9;">Saldo Preditivo Mensal</span>
        <div class="amount" style="font-size:1.8rem; font-weight:800; margin-top:4px;">${formatCurrency(projBalance)}</div>
      </div>

      <div class="card">
        <h3 style="font-size:0.85rem; margin-bottom:10px;">Resumo de Recorrência</h3>
        <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:8px;">
          <span>Entradas Fixas Mensais:</span> <strong class="text-income">${formatCurrency(fixedIn)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
          <span>Saídas Fixas:</span> <strong class="text-expense">- ${formatCurrency(fixedOut)}</strong>
        </div>
      </div>
    `;
  }
}

function renderCategoryChart(catTotals) {
  const total = Object.values(catTotals).reduce((a, b) => a + b, 0);
  if (total === 0) return `<p style="font-size:0.75rem; color:var(--text-muted); text-align:center; padding:10px;">Sem despesas no período.</p>`;

  let cumulativePercent = 0;
  const slices = [];

  Object.entries(catTotals).forEach(([cat, val]) => {
    const pct = val / total;
    const startAngle = cumulativePercent * 360;
    cumulativePercent += pct;
    const endAngle = cumulativePercent * 360;

    const x1 = Math.cos((Math.PI * startAngle) / 180);
    const y1 = Math.sin((Math.PI * startAngle) / 180);
    const x2 = Math.cos((Math.PI * endAngle) / 180);
    const y2 = Math.sin((Math.PI * endAngle) / 180);

    const largeArc = pct > 0.5 ? 1 : 0;
    const pathData = `M 0 0 L ${x1} ${y1} A 1 1 0 ${largeArc} 1 ${x2} ${y2} Z`;

    slices.push({ pathData, color: CATEGORY_COLORS[cat] || '#94a3b8', cat, val });
  });

  let legendHtml = Object.entries(catTotals).map(([cat, val]) => `
    <div class="legend-item">
      <div class="legend-color" style="background-color: ${CATEGORY_COLORS[cat] || '#94a3b8'}"></div>
      <span>${cat}: <strong>${formatCurrency(val)}</strong></span>
    </div>
  `).join('');

  return `
    <div class="chart-container">
      <svg viewBox="-1 -1 2 2" style="width: 90px; height: 90px; transform: rotate(-90deg); border-radius:50%;">
        ${slices.map(s => `<path d="${s.pathData}" fill="${s.color}" />`).join('')}
      </svg>
      <div class="chart-legend">${legendHtml}</div>
    </div>
  `;
}

// --- FUNÇÕES DE ESCRITA NO FIREBASE ---
window.openQuickAddModal = function() {
  document.getElementById('modal-transaction').classList.add('active');
  document.getElementById('tx-date').value = formatDateKey(selectedDate);
  populateCardDropdown();
};

window.closeModal = function(id) {
  document.getElementById(id).classList.remove('active');
};

window.toggleCardSelector = function() {
  const method = document.getElementById('tx-payment-method').value;
  const cardSelect = document.getElementById('tx-card-id');
  cardSelect.style.display = method === 'card' ? 'block' : 'none';
};

window.toggleInstallmentField = function() {
  const rec = document.getElementById('tx-recurrence').value;
  const field = document.getElementById('tx-installments');
  field.style.display = rec === 'installment' ? 'block' : 'none';
};

function populateCardDropdown() {
  const select = document.getElementById('tx-card-id');
  select.innerHTML = cards.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

window.saveTransaction = async function(e) {
  e.preventDefault();
  const desc = document.getElementById('tx-desc').value;
  const amount = parseFloat(document.getElementById('tx-amount').value);
  const dateStr = document.getElementById('tx-date').value;
  const type = document.getElementById('tx-type').value;
  const category = document.getElementById('tx-category').value;
  const method = document.getElementById('tx-payment-method').value;
  const cardId = method === 'card' ? parseInt(document.getElementById('tx-card-id').value) : null;
  const status = document.getElementById('tx-status').value;
  const recurrence = document.getElementById('tx-recurrence').value;
  const installments = parseInt(document.getElementById('tx-installments').value) || 1;

  if (!Number.isFinite(amount) || amount <= 0 || !dateStr) return;

  if (recurrence === 'installment' && installments > 1) {
    const installmentAmount = amount / installments;
    const baseDate = new Date(dateStr + 'T00:00:00');
    const batch = writeBatch(db);

    for (let i = 0; i < installments; i++) {
      const nextDate = new Date(baseDate);
      nextDate.setMonth(nextDate.getMonth() + i);

      batch.set(doc(txCollection), {
        id: Date.now() + i,
        description: desc,
        amount: installmentAmount,
        type, category, status, method, cardId, recurrence,
        installmentsInfo: `${i + 1}/${installments}`,
        date: formatDateKey(nextDate)
      });
    }
    await batch.commit();
  } else {
    await addDoc(txCollection, {
      id: Date.now(),
      description: desc,
      amount, type, category, status, method, cardId, recurrence,
      date: dateStr
    });
  }

  window.closeModal('modal-transaction');
};

window.toggleTxStatus = async function(docId, currentStatus) {
  const newStatus = currentStatus === 'paid' ? 'pending' : 'paid';
  const docRef = doc(db, "transactions", docId);
  await updateDoc(docRef, { status: newStatus });
};

window.openAddCardPrompt = async function() {
  const name = prompt('Nome do Cartão:');
  const limit = parseFloat(prompt('Limite Total do Cartão (R$):'));
  const closingDay = parseInt(prompt('Dia de Fechamento da Fatura:'));
  const dueDay = parseInt(prompt('Dia de Vencimento da Fatura:'));

  if (name && limit && closingDay && dueDay) {
    await addDoc(cardsCollection, { id: Date.now(), name, limit, closingDay, dueDay });
  }
};

window.openAddBudgetPrompt = async function() {
  const category = prompt('Categoria:');
  const limit = parseFloat(prompt('Teto Máximo Mensal (R$):'));

  if (category && limit) {
    await addDoc(budgetsCollection, { category, limit });
  }
};

// --- BACKUP E MODAIS SECUNDÁRIOS ---
window.openBackupModal = function() {
  document.getElementById('modal-backup').classList.add('active');
};

window.openImportModal = function() {
  window.closeModal('modal-backup');
  document.getElementById('modal-import').classList.add('active');
};

window.exportJSON = function() {
  const data = JSON.stringify({ transactions, cards, budgets }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fincontrol_cloud_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
};

window.exportCSV = function() {
  let csv = 'Data;Descrição;Valor;Tipo;Categoria;Status\n';
  transactions.forEach(t => {
    csv += `${t.date};${t.description};${t.amount};${t.type};${t.category};${t.status}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `extrato_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
};

window.processBankFile = function(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(evt) {
    const lines = evt.target.result.split('\n');
    let importedCount = 0;
    const importedTransactions = [];

    for (const line of lines) {
      if (line.includes(';')) {
        const parts = line.split(';');
        if (parts.length >= 3 && !isNaN(parseFloat(parts[2]))) {
          importedTransactions.push({
            id: Date.now() + Math.random(),
            description: parts[1] || 'Importado Banco',
            amount: Math.abs(parseFloat(parts[2])),
            type: parseFloat(parts[2]) < 0 ? 'expense' : 'income',
            category: 'Outros',
            status: 'paid',
            method: 'account',
            date: formatDateKey(new Date())
          });
          importedCount++;
        }
      }
    }

    for (let index = 0; index < importedTransactions.length; index += 500) {
      const batch = writeBatch(db);
      importedTransactions.slice(index, index + 500).forEach(transaction => batch.set(doc(txCollection), transaction));
      await batch.commit();
    }

    importedTransactions.length = 0;

    alert(`${importedCount} lançamentos importados no Firebase!`);
    for (let index = 0; index < importedTransactions.length; index += 500) {
      const batch = writeBatch(db);
      importedTransactions.slice(index, index + 500).forEach(transaction => batch.set(doc(txCollection), transaction));
      await batch.commit();
    }
    window.closeModal('modal-import');
  };
  reader.readAsText(file);
};

document.addEventListener('DOMContentLoaded', () => {
  subscribeTransactionsForPeriod();
  scheduleRender();
});
