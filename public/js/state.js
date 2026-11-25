const now = new Date();

export const state = {
  currentView: 'dashboard',
  dashboardSection: 'all',
  habitsMoodDays: 30,
  selectedHeatmapDate: null,
  selectedCalendarDate: null,
  planSubMode: 'active',
  areasSubTab: 'finance',
  financeTypeFilter: '',
  editingGoalId: null,
  editingProjectId: null,
  editingTaskId: null,
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

  // Chat persistente, voz y cola segura de propuestas
  conversations: [],
  activeConversationId: null,
  chatMessages: [],
  copilotQueue: [],
  copilotRejected: [],
  copilotMode: 'deterministic_local',
  copilotSending: false,
  ttsEnabled: false,
  speakingMessageId: null,
  voiceState: 'idle',
  voiceClip: null,
};
