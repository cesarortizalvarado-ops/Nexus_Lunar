const now = new Date();

export const state = {
  currentView: 'dashboard',
  planSubMode: 'active',
  areasSubTab: 'finance',
  health: null,
  catalog: null,
  storageHealth: null,
  modules: [],
  snapshot: null,
  baselines: [],
  selectedBaselineId: null,
  baselineDetail: null,
  saturdayReview: null,

  // Dashboards y calendario
  dashHabitsMood: null,
  dashProjectsGoals: null,
  dashCalendar: null,
  calendarYear: now.getFullYear(),
  calendarMonth: now.getMonth() + 1,

  // Bienestar
  importantDates: [],
  moods: [],

  // Áreas y bibliotecas
  goals: [],
  projects: [],
  tasks: [],
  habits: [],
  routines: [],
  financeSummary: null,
  financeAccounts: [],
  financeTransactions: [],
  inventoryProducts: [],
  inventoryStock: [],
  libraries: [],
  libraryDocuments: [],
  selectedLibraryId: '',

  // Sistema
  backups: [],
  seedResult: null,
  doctorReport: null,

  // Editores temporales en Espacios
  draftEmployments: null,
  draftCommitments: null,

  // Chat persistente y cola segura de propuestas
  conversations: [],
  activeConversationId: null,
  chatMessages: [],
  copilotQueue: [],
  copilotRejected: [],
  copilotMode: 'deterministic_local',
  copilotSending: false,
};
