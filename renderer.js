let state = null;
let selectedApp = 'all';
let editingAppId = null;
let mergeSource = null;
let lastDetectedTitle = '';
let dataActionMessage = null;
let activePage = 'overview';
let localizedLanguage = null;
let linkSourceAppId = null;
let renamingGroupId = null;
let deferredStateRender = false;
let settingsFormDirty = false;
let confirmResolver = null;
let lastOverviewTotalsRenderAt = 0;

const CREATE_EMPTY_PROJECT = '__create-empty-project__';

const TRANSLATIONS = {
  ru: {
    localTracking: 'Локальный учёт времени', overview: 'Проекты', applications: 'Программы', settings: 'Настройки', minimize: 'Свернуть в трей', localOnly: 'Статистика хранится только на этом компьютере.',
    workTime: 'Обзор проектов', workSubtitle: 'Автоматический учёт активных проектов и контейнеров', total: 'Всего', allTime: 'За всё время', projects: 'Проекты', uniqueFiles: 'Уникальных файлов', monitored: 'Под наблюдением',
    projectsSubtitle: 'Объединяйте проекты из разных программ в контейнеры', appSection: 'Отслеживаемые программы', appSectionSubtitle: 'Добавьте процесс и расширения рабочих файлов.', appList: 'Список программ',
    addApp: 'Добавить программу', editApp: 'Редактировать программу', exampleApp: 'Например, Substance Painter', statsPreserved: 'Статистика и проекты сохранятся', activeWindow: 'Активное окно', chooseExe: 'Выбрать EXE',
    activeHelp: 'Откройте нужную программу не меньше чем на один интервал проверки, затем вернитесь и нажмите «Активное окно».', name: 'Название', processName: 'Имя процесса', processHelp: 'Можно посмотреть в Диспетчере задач. «.exe» указывать необязательно.', extensions: 'Расширения файлов', extensionsHelp: 'Через запятую. Используются для поиска имени в заголовке и фильтра выбора файлов.',
    projectMeaning: 'Как определять проект', modeFile: 'По первой части заголовка окна', modeSegment: 'По выбранной части заголовка', modeTrackedFile: 'По изменению выбранного файла', modeApp: 'Вся программа — один проект', chooseTitlePart: 'Нажмите на часть заголовка, которая обозначает проект:', addTracking: 'Добавить в отслеживание', saveChanges: 'Сохранить изменения', cancel: 'Отмена',
    parameters: 'Параметры', generalSettings: 'Общие настройки', settingsSubtitle: 'Настройте частоту проверки и реакцию на бездействие.', activityTracking: 'Учёт активности', settingsApply: 'Изменения применяются к фоновому монитору сразу после сохранения.', interfaceLanguage: 'Язык интерфейса', languageHelp: 'Меняет язык окна, подсказок, ошибок и меню в системном трее.', russian: 'Русский', launchAtStartup: 'Запускать вместе с Windows', launchAtStartupHelp: 'WorkTracer запустится в системном трее без открытия основного окна.',
    pollInterval: 'Интервал проверки', pollHelp: 'Как часто проверять активное окно. Меньшее значение точнее, но создаёт больше системных обращений.', idleThreshold: 'Порог бездействия', idleHelp: 'Не учитывать время, если пользователь не двигает мышь и не нажимает клавиши. Значение 0 отключает проверку.', secondsShort: 'сек', minutesShort: 'мин', saveSettings: 'Сохранить настройки', resetStats: 'Сбросить статистику', resetHelp: 'Настройки программ останутся без изменений.', clearData: 'Очистить данные',
    mergeProject: 'Объединить проекты', allApps: 'Все программы', pause: 'Приостановить', resume: 'Возобновить', waitingWindow: 'Ожидание активного окна', trackingPaused: 'Учёт времени приостановлен', resumeHelp: 'Нажмите «Возобновить», чтобы продолжить.', trackingNow: 'Сейчас отслеживается', mergedBadge: 'КОНТЕЙНЕР', inProject: 'В этом проекте',
    noProjects: 'Пока нет записанных проектов', noProjectsHelp: 'Статистика появится после обнаружения активного окна.', mergedProject: 'Контейнер', totalTime: 'общее время', tracking: 'Учёт идёт', waiting: 'Ожидание', monitoringActive: 'Мониторинг активен', onPause: 'На паузе', notRecording: 'Время не записывается',
    fileModeHint: 'Первая часть заголовка активного окна используется для определения проекта.', trackedFileModeHint: 'Время проекта начинает учитываться только после изменения выбранного файла на диске.', appModeHint: 'Всё время работы в программе записывается в один проект независимо от открытого документа.', segmentModeHint: 'Вторая часть заголовка активного окна используется для определения проекта.', noTitleHint: 'Сначала используйте «Активное окно», чтобы выбрать часть реального заголовка.', preview: 'Будет определён проект: {name}',
    processLine: 'Процесс: {process} · {extensions}', projectCount: '{count} проектов', filesCount: '{count} файла', combinedCount: '{count} проектов в контейнере', lastChange: '{count} файла · последнее изменение {date}', groupTime: 'Общее время · {count} файла',
    detected: 'Обнаружен процесс {process}{title}', selectedFile: 'Выбран файл: {path}', dataFile: 'Файл данных: {path}', checkingEvery: 'Откройте отслеживаемую программу — проверка выполняется каждые {seconds} сек.',
    editTitle: 'Редактировать', deleteTitle: 'Удалить', mergeTitle: 'Объединить и создать контейнер', addMergeTitle: 'Добавить проект в контейнер', deleteProjectTitle: 'Удалить проект', leaveMergeTitle: 'Извлечь из контейнера', closeTitle: 'Закрыть',
    mergeCaptionAdd: 'Добавить ещё один проект в контейнер', mergeCaptionChoose: 'Выберите проект — для них будет создан контейнер', noMergeTargets: 'Нет других проектов для добавления.',
    unsupported: 'Определение активного окна сейчас поддерживается только в Windows.', monitorFailed: 'Монитор активного окна не работает: {details}', databaseFailed: 'Хранилище работает в состоянии «{state}». Последнее изменение могло не сохраниться.', monitorFailureStatus: 'Ошибка монитора', monitorFailureShort: 'Откройте раздел «Обзор», чтобы увидеть подробности.', confirmApp: 'Перед удалением будет создана проверенная резервная копия. Удалить программу, её проекты, файлы и интервалы?', confirmProject: 'Перед удалением будет создана проверенная резервная копия. Удалить проект, tracked files, links и интервалы?', confirmClear: 'Будет создана резервная копия, затем удалены интервалы, проекты, tracked files, links и контейнеры. Настройки и список программ сохранятся. Продолжить?', confirmation: 'Подтверждение', noFile: 'Без отдельного файла', loadMore: 'Показать ещё проекты',
    byWindowTitle: 'по заголовку окна', addFirstApp: 'Добавьте первую программу.',
    dataFiles: 'Файлы данных', dataFilesHelp: 'SQLite-база и многопоколенные проверяемые резервные копии.', openFolder: 'Открыть папку', createBackup: 'Создать резервную копию', mainFile: 'База SQLite', backupCopy: 'Каталог резервных копий', backupCreated: 'Проверенная резервная копия успешно создана.', folderOpened: 'Папка данных открыта.', recoveredBackup: 'Повреждённая база была сохранена для диагностики и восстановлена из проверенной резервной копии.',
    hourlyRate: 'Стоимость часа', hourlyRateHelp: 'Условная ставка для расчёта стоимости времени каждого проекта.', earned: 'Стоимость отработанного времени', linkProgram: 'Линки программы', linksFor: 'Куда направлять время программы «{name}»', noLinks: 'Линки ещё не созданы.', activeLink: 'Активен', pausedLink: 'На паузе', addLink: 'Добавить линк на проект', linkTargetMissing: 'Целевой проект удалён', linkTime: 'Передано через линк: {time}', renameGroupPrompt: 'Название контейнера:', renameTitle: 'Переименовать', addTrackedFileTitle: 'Добавить отслеживаемый файл', linkedTo: 'Время также направляется в «{name}»', groupName: 'Название контейнера', groupNameHelp: 'Задайте понятное имя контейнера проекта.', createEmptyProject: 'Создать пустой контейнер', emptyProjectHelp: 'Создайте контейнер, в который затем можно добавить файлы и проекты из разных программ.', manualProject: 'Контейнер проекта', emptyContainer: 'Пока пусто — добавьте файл или проект', containerContents: '{count} элементов · последнее изменение {date}',
  },
  en: {
    localTracking: 'Local time tracking', overview: 'Projects', applications: 'Applications', settings: 'Settings', minimize: 'Minimize to tray', localOnly: 'Statistics are stored only on this computer.',
    workTime: 'Project overview', workSubtitle: 'Automatic tracking of active projects and containers', total: 'Total', allTime: 'All time', projects: 'Projects', uniqueFiles: 'Unique files', monitored: 'Monitored',
    projectsSubtitle: 'Combine projects from different applications into containers', appSection: 'Tracked applications', appSectionSubtitle: 'Add a process and its working file extensions.', appList: 'Application list',
    addApp: 'Add application', editApp: 'Edit application', exampleApp: 'For example, Substance Painter', statsPreserved: 'Statistics and projects will be preserved', activeWindow: 'Active window', chooseExe: 'Select EXE',
    activeHelp: 'Open the required application for at least one check interval, then return and click “Active window”.', name: 'Name', processName: 'Process name', processHelp: 'You can find it in Task Manager. The “.exe” suffix is optional.', extensions: 'File extensions', extensionsHelp: 'Separate with commas. Used for title matching and the tracked-file picker.',
    projectMeaning: 'How to identify a project', modeFile: 'By the first part of the window title', modeSegment: 'By selected part of the title', modeTrackedFile: 'By changes to a selected file', modeApp: 'Entire application — one project', chooseTitlePart: 'Click the title part that identifies the project:', addTracking: 'Add to tracking', saveChanges: 'Save changes', cancel: 'Cancel',
    parameters: 'Preferences', generalSettings: 'General settings', settingsSubtitle: 'Configure check frequency and idle behavior.', activityTracking: 'Activity tracking', settingsApply: 'Changes are applied to the background monitor immediately after saving.', interfaceLanguage: 'Interface language', languageHelp: 'Changes the window, hints, errors, and system tray menu language.', russian: 'Russian', launchAtStartup: 'Start with Windows', launchAtStartupHelp: 'WorkTracer starts in the system tray without opening the main window.',
    pollInterval: 'Check interval', pollHelp: 'How often to check the active window. Lower values are more precise but create more system calls.', idleThreshold: 'Idle threshold', idleHelp: 'Do not count time when there is no mouse or keyboard input. Set to 0 to disable.', secondsShort: 'sec', minutesShort: 'min', saveSettings: 'Save settings', resetStats: 'Reset statistics', resetHelp: 'Application settings will remain unchanged.', clearData: 'Clear data',
    mergeProject: 'Combine projects', allApps: 'All applications', pause: 'Pause', resume: 'Resume', waitingWindow: 'Waiting for an active window', trackingPaused: 'Time tracking is paused', resumeHelp: 'Click “Resume” to continue.', trackingNow: 'Tracking now', mergedBadge: 'CONTAINER', inProject: 'In this project',
    noProjects: 'No projects recorded yet', noProjectsHelp: 'Statistics will appear after a tracked window is detected.', mergedProject: 'Container', totalTime: 'total time', tracking: 'Tracking', waiting: 'Waiting', monitoringActive: 'Monitoring is active', onPause: 'Paused', notRecording: 'Time is not being recorded',
    fileModeHint: 'The first part of the active window title is used to identify the project.', trackedFileModeHint: 'Project time starts only after the selected file changes on disk.', appModeHint: 'All time in the application is recorded as one project regardless of the open document.', segmentModeHint: 'The second part of the active window title is used to identify the project.', noTitleHint: 'Use “Active window” first to select a part of the real window title.', preview: 'Detected project: {name}',
    processLine: 'Process: {process} · {extensions}', projectCount: '{count} projects', filesCount: '{count} files', combinedCount: '{count} projects in container', lastChange: '{count} files · last change {date}', groupTime: 'Container time · {count} files',
    detected: 'Detected process {process}{title}', selectedFile: 'Selected file: {path}', dataFile: 'Data file: {path}', checkingEvery: 'Open a tracked application — the active window is checked every {seconds} sec.',
    editTitle: 'Edit', deleteTitle: 'Delete', mergeTitle: 'Combine and create a container', addMergeTitle: 'Add a project to the container', deleteProjectTitle: 'Delete project', leaveMergeTitle: 'Remove from container', closeTitle: 'Close',
    mergeCaptionAdd: 'Add another project to the container', mergeCaptionChoose: 'Select a project — a container will be created for both', noMergeTargets: 'There are no other projects to add.',
    unsupported: 'Active window detection is currently supported only on Windows.', monitorFailed: 'The active-window monitor is not working: {details}', databaseFailed: 'Storage is in “{state}” state. The latest change may not be durable.', monitorFailureStatus: 'Monitor error', monitorFailureShort: 'Open Overview to see the error details.', confirmApp: 'A validated backup will be created first. Delete the application, projects, files, and intervals?', confirmProject: 'A validated backup will be created first. Delete the project, tracked files, links, and intervals?', confirmClear: 'A backup will be created, then intervals, projects, tracked files, links, and containers will be deleted. Settings and application configuration stay. Continue?', confirmation: 'Confirmation', noFile: 'No separate file', loadMore: 'Show more projects',
    byWindowTitle: 'from window title', addFirstApp: 'Add your first application.',
    dataFiles: 'Data files', dataFilesHelp: 'SQLite database and validated multi-generation backups.', openFolder: 'Open folder', createBackup: 'Create backup', mainFile: 'SQLite database', backupCopy: 'Backup directory', backupCreated: 'Validated backup created successfully.', folderOpened: 'Data folder opened.', recoveredBackup: 'The damaged database was preserved for diagnostics and restored from a validated backup.',
    hourlyRate: 'Hourly rate', hourlyRateHelp: 'A custom rate used to calculate the value of time spent on each project.', earned: 'Value of time worked', linkProgram: 'Application links', linksFor: 'Where to allocate time from “{name}”', noLinks: 'No links have been created yet.', activeLink: 'Active', pausedLink: 'Paused', addLink: 'Add link to project', linkTargetMissing: 'Target project was deleted', linkTime: 'Allocated through link: {time}', renameGroupPrompt: 'Container name:', renameTitle: 'Rename', addTrackedFileTitle: 'Add tracked file', linkedTo: 'Time is also allocated to “{name}”', groupName: 'Container name', groupNameHelp: 'Set a clear name for the project container.', createEmptyProject: 'Create empty container', emptyProjectHelp: 'Create a container, then add files and projects from different applications.', manualProject: 'Project container', emptyContainer: 'Empty — add a file or project', containerContents: '{count} items · last change {date}',
  },
};

function language() { return state?.settings?.language === 'en' ? 'en' : 'ru'; }
function t(key, values = {}) {
  return (TRANSLATIONS[language()][key] || TRANSLATIONS.ru[key] || key).replace(/\{(\w+)\}/g, (_match, name) => values[name] ?? '');
}

function appDisplayName(app) {
  return app?.isManual ? t('manualProject') : app?.name || '';
}

const elements = {
  currentCard: document.querySelector('#current-card'),
  projectList: document.querySelector('#project-list'),
  appList: document.querySelector('#app-list'),
  appFilter: document.querySelector('#app-filter'),
  createEmptyProjectButton: document.querySelector('#create-empty-project-button'),
  addProjectFileButton: document.querySelector('#add-project-file-button'),
  trackingToggle: document.querySelector('#tracking-toggle'),
  sidebarStatus: document.querySelector('#sidebar-status'),
  unsupportedWarning: document.querySelector('#unsupported-warning'),
  mainDataPath: document.querySelector('#main-data-path'),
  backupDataPath: document.querySelector('#backup-data-path'),
  dataActionStatus: document.querySelector('#data-action-status'),
  formError: document.querySelector('#form-error'),
  detectedSource: document.querySelector('#detected-source'),
  appNameInput: document.querySelector('#app-name'),
  processNameInput: document.querySelector('#process-name'),
  executablePathInput: document.querySelector('#executable-path'),
  extensionsInput: document.querySelector('#extensions'),
  appFormTitle: document.querySelector('#app-form-title'),
  appFormSubtitle: document.querySelector('#app-form-subtitle'),
  appSubmitButton: document.querySelector('#app-submit-button'),
  cancelEditButton: document.querySelector('#cancel-edit-button'),
  settingsForm: document.querySelector('#settings-form'),
  pollInterval: document.querySelector('#poll-interval'),
  idleTimeout: document.querySelector('#idle-timeout'),
  hourlyRate: document.querySelector('#hourly-rate'),
  settingsError: document.querySelector('#settings-error'),
  languageSelect: document.querySelector('#language-select'),
  launchAtStartup: document.querySelector('#launch-at-startup'),
  mergeModal: document.querySelector('#merge-modal'),
  mergeCaption: document.querySelector('#merge-caption'),
  mergeProjectList: document.querySelector('#merge-project-list'),
  projectMode: document.querySelector('#project-mode'),
  titleSegmentFromEnd: document.querySelector('#title-segment-from-end'),
  titleSegmentPicker: document.querySelector('#title-segment-picker'),
  titleSegments: document.querySelector('#title-segments'),
  projectPreview: document.querySelector('#project-preview'),
  projectModeHint: document.querySelector('#project-mode-hint'),
  linkModal: document.querySelector('#link-modal'),
  linkCaption: document.querySelector('#link-caption'),
  linkExistingList: document.querySelector('#link-existing-list'),
  linkProjectList: document.querySelector('#link-project-list'),
  renameGroupModal: document.querySelector('#rename-group-modal'),
  renameGroupForm: document.querySelector('#rename-group-form'),
  renameGroupInput: document.querySelector('#rename-group-input'),
  renameGroupError: document.querySelector('#rename-group-error'),
  projectNameModalTitle: document.querySelector('#project-name-modal-title'),
  projectNameModalHelp: document.querySelector('#project-name-modal-help'),
  confirmModal: document.querySelector('#confirm-modal'),
  confirmMessage: document.querySelector('#confirm-message'),
  confirmActionButton: document.querySelector('#confirm-action-button'),
};

const icon = {
  pause: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 5v14M16 5v14"/></svg>',
  play: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="m8 5 11 7-11 7z"/></svg>',
  pulse: '<span class="relative flex h-2.5 w-2.5"><span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"></span><span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400"></span></span>',
  merge: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>',
  link: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12a4 4 0 0 0 6 3l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M15 12a4 4 0 0 0-6-3l-3 3a4 4 0 0 0 6 6l1-1"/></svg>',
  pencil: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.5 7l3.5 3.5"/></svg>',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function formatDuration(seconds) {
  const rounded = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (language() === 'en') {
    if (hours > 0) return `${hours} h ${minutes} min`;
    if (minutes > 0) return `${minutes} min`;
    return `${rounded} sec`;
  }
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин`;
  return `${rounded} сек`;
}

function formatCoins(seconds) {
  const amount = (Math.max(0, Number(seconds) || 0) / 3600) * Math.max(0, Number(state?.settings?.hourlyRate) || 0);
  return new Intl.NumberFormat(language() === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 2 }).format(amount);
}

function coinValue(seconds, alignment = '') {
  return `<div class="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-400 ${alignment}" title="${t('earned')}"><span class="grid h-4 w-4 place-items-center rounded-full border border-amber-300/30 bg-amber-400/10 text-[8px] font-bold">C</span><span>${formatCoins(seconds)}</span></div>`;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(language() === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function localizeDocument() {
  const targetLanguage = language();
  if (localizedLanguage === targetLanguage) return;
  const valueMap = new Map();
  for (const key of Object.keys(TRANSLATIONS.ru)) {
    if (TRANSLATIONS.ru[key].includes('{') || TRANSLATIONS.en[key].includes('{')) continue;
    valueMap.set(TRANSLATIONS.ru[key], TRANSLATIONS[targetLanguage][key]);
    valueMap.set(TRANSLATIONS.en[key], TRANSLATIONS[targetLanguage][key]);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const trimmed = node.nodeValue.trim();
    if (trimmed && valueMap.has(trimmed)) node.nodeValue = node.nodeValue.replace(trimmed, valueMap.get(trimmed));
  }
  document.querySelectorAll('[placeholder],[title]').forEach((element) => {
    for (const attribute of ['placeholder', 'title']) {
      const value = element.getAttribute(attribute);
      if (valueMap.has(value)) element.setAttribute(attribute, valueMap.get(value));
    }
  });
  document.documentElement.lang = targetLanguage;
  localizedLanguage = targetLanguage;
}

function splitWindowTitle(title) {
  return String(title || '').split(/\s+(?:-|—|\|)\s+/).map((part) => part.trim().replace(/^[●•*]\s*/, '')).filter(Boolean);
}

function encodeMember(member) {
  return encodeURIComponent(JSON.stringify({ appId: member.appId, projectName: member.projectName }));
}

function decodeMember(value) {
  return JSON.parse(decodeURIComponent(value));
}

function sameMember(left, right) {
  return left?.appId === right?.appId && left?.projectName === right?.projectName;
}

function memberKey(member) {
  return `${member?.appId || ''}\u0000${member?.projectName || ''}`;
}

function flatProjects() {
  return state.apps.flatMap((app) => {
    const stats = state.statistics[app.id] || { projects: {} };
    return Object.entries(stats.projects || {}).map(([name, project]) => {
      const member = { appId: app.id, projectName: name };
      const incomingLinks = (state.projectLinks || []).filter((link) => sameMember(link.target, member));
      const linkedSeconds = incomingLinks.reduce((sum, link) => sum + (Number(link.seconds) || 0), 0);
      const linkedLastUsed = incomingLinks.reduce((latest, link) => !latest || new Date(link.lastUsed || 0) > new Date(latest) ? link.lastUsed : latest, null);
      return {
        ...project,
        seconds: (Number(project.seconds) || 0) + linkedSeconds,
        ownSeconds: Number(project.seconds) || 0,
        linkedSeconds,
        lastUsed: new Date(linkedLastUsed || 0) > new Date(project.lastUsed || 0) ? linkedLastUsed : project.lastUsed,
        name,
        app,
        member,
      };
    });
  }).sort((a, b) => new Date(b.lastUsed || 0) - new Date(a.lastUsed || 0));
}

function groupFor(member) {
  return (state.projectGroups || []).find((group) => group.members.some((item) => sameMember(item, member)));
}

function resolveMember(member, projects = flatProjects()) {
  return projects.find((project) => sameMember(project.member, member));
}

function groupDetails(group, projects = flatProjects(), projectLookup = null) {
  const lookup = projectLookup || new Map(projects.map((project) => [memberKey(project.member), project]));
  const members = group.members.map((member) => lookup.get(memberKey(member))).filter(Boolean);
  return {
    ...group,
    resolvedMembers: members,
    seconds: Number.isFinite(Number(group.seconds)) ? Number(group.seconds) : members.reduce((sum, project) => sum + (Number(project.seconds) || 0), 0),
    lastUsed: group.lastUsed || members.reduce((latest, project) => !latest || new Date(project.lastUsed || 0) > new Date(latest) ? project.lastUsed : latest, null),
  };
}

function renderCurrentActivity(projects = flatProjects()) {
  if (state.currentActivity) {
    const activity = state.currentActivity;
    const member = { appId: activity.appId, projectName: activity.projectName };
    const group = groupFor(member);
    const activityProject = resolveMember(member, projects);
    const projectSeconds = group
      ? groupDetails(group, projects).seconds
      : activityProject?.seconds || 0;
    const groupProjectCount = group ? groupDetails(group, projects).resolvedMembers.filter((project) => !project.app.isManual).length : 0;
    const timeLabel = group ? t('groupTime', { count: groupProjectCount }) : t('inProject');
    const linkedProject = activity.linkedTarget ? resolveMember(activity.linkedTarget, projects) : null;
    const linkedGroup = activity.linkedTarget ? groupFor(activity.linkedTarget) : null;
    const linkedName = linkedGroup?.name || linkedProject?.name;
    const linkedLine = linkedName ? `<div class="mt-1 truncate text-[11px] text-sky-400">${icon.link}<span class="ml-1">${t('linkedTo', { name: escapeHtml(linkedName) })}</span></div>` : '';
    elements.currentCard.innerHTML = `
      <div class="relative flex items-center gap-5 overflow-hidden p-5">
        <div class="absolute inset-y-0 left-0 w-1 bg-emerald-400"></div>
        <div class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-emerald-400/10 text-emerald-400">${icon.pulse}</div>
        <div class="min-w-0 flex-1"><div class="mb-1 flex items-center gap-2"><span class="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-400">${t('trackingNow')}</span>${group ? `<span class="rounded bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-violet-400">${t('mergedBadge')}</span>` : ''}</div><div class="truncate text-base font-semibold text-white">${escapeHtml(activity.projectName === 'Без отдельного файла' ? t('noFile') : activity.projectName)}</div><div class="mt-0.5 truncate text-xs text-slate-500">${escapeHtml(activity.appName)} · ${escapeHtml(activity.windowTitle)}</div>${linkedLine}</div>
        <div class="text-right"><div class="font-mono text-xl font-semibold text-white">${formatDuration(projectSeconds)}</div><div class="mt-1 text-[10px] uppercase tracking-wider text-slate-600">${timeLabel}</div>${coinValue(projectSeconds, 'justify-end')}</div>
      </div>`;
  } else {
    elements.currentCard.innerHTML = `
      <div class="flex items-center gap-4 p-5"><div class="grid h-11 w-11 place-items-center rounded-xl bg-slate-800/60 text-slate-500"><svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div><div><div class="text-sm font-medium text-slate-300">${state.trackingEnabled ? t('waitingWindow') : t('trackingPaused')}</div><div class="mt-1 text-xs text-slate-600">${state.trackingEnabled ? t('checkingEvery', { seconds: state.settings.pollIntervalSeconds }) : t('resumeHelp')}</div></div></div>`;
  }
}

function renderProjectRows(projects) {
  const projectLookup = new Map(projects.map((project) => [memberKey(project.member), project]));
  const groupedMemberKeys = new Set((state.projectGroups || []).flatMap((group) => group.members.map(memberKey)));
  const entities = [];

  for (const group of state.projectGroups || []) {
    const details = groupDetails(group, projects, projectLookup);
    if (!details.resolvedMembers.length) continue;
    if (selectedApp !== 'all' && !details.resolvedMembers.some((project) => project.app.id === selectedApp)) continue;
    entities.push({ type: 'group', lastUsed: details.lastUsed, details });
  }
  for (const project of projects) {
    if (groupedMemberKeys.has(memberKey(project.member))) continue;
    if (selectedApp !== 'all' && project.app.id !== selectedApp) continue;
    entities.push({ type: 'project', lastUsed: project.lastUsed, project });
  }
  entities.sort((a, b) => new Date(b.lastUsed || 0) - new Date(a.lastUsed || 0));

  if (!entities.length) {
    return `<div class="px-5 py-12 text-center"><div class="text-sm text-slate-500">${t('noProjects')}</div><div class="mt-1 text-xs text-slate-700">${t('noProjectsHelp')}</div></div>`;
  }

  return entities.map((entity) => {
    if (entity.type === 'project') {
      const project = entity.project;
      const encoded = encodeMember(project.member);
      const appDisplayName = project.app.isManual ? t('manualProject') : project.app.name;
      const linkedHint = project.linkedSeconds > 0 ? `<div class="mt-0.5 text-[10px] text-sky-500">${t('linkTime', { time: formatDuration(project.linkedSeconds) })}</div>` : '';
      const activeLinks = (state.projectLinks || []).filter((link) => link.sourceAppId === project.app.id && link.enabled).length;
      const primaryAction = project.app.projectMode === 'app'
        ? `<button class="icon-button link-project ${activeLinks ? 'text-emerald-400' : 'text-sky-500'}" data-app-id="${escapeHtml(project.app.id)}" title="${t('linkProgram')}">${icon.link}</button>`
        : project.app.projectMode === 'tracked-file'
          ? `<button class="icon-button add-file-for-app text-sky-500" data-app-id="${escapeHtml(project.app.id)}" title="${t('addTrackedFileTitle')}"><svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h7l2 2h9v11H3z"/><path d="M12 11v5M9.5 13.5h5"/></svg></button>`
          : `<button class="icon-button merge-project text-sky-500" data-member="${encoded}" title="${t('mergeTitle')}">${icon.merge}</button>`;
      return `<div class="grid grid-cols-[minmax(0,1fr)_130px_100px_76px] items-center gap-3 border-b border-slate-800/60 px-5 py-4 last:border-0 hover:bg-white/[0.015]">
        <div class="flex min-w-0 items-center gap-3"><div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-800/70 text-xs font-bold text-sky-400">${escapeHtml(appDisplayName.slice(0, 1).toUpperCase())}</div><div class="min-w-0"><div class="truncate text-sm font-medium text-slate-200">${escapeHtml(project.name === 'Без отдельного файла' ? t('noFile') : project.name)}</div><div class="mt-0.5 text-[11px] text-slate-600">${escapeHtml(appDisplayName)}</div>${linkedHint}</div></div>
        <div class="text-xs text-slate-500">${formatDate(project.lastUsed)}</div><div class="text-right"><div class="font-mono text-sm font-semibold text-slate-200">${formatDuration(project.seconds)}</div>${coinValue(project.seconds, 'justify-end')}</div>
        <div class="flex justify-end">${primaryAction}<button class="icon-button delete-project hover:text-rose-400" data-member="${encoded}" title="${t('deleteProjectTitle')}">${icon.trash}</button></div>
      </div>`;
    }

    const group = entity.details;
    const contentProjects = group.resolvedMembers.filter((project) => !project.app.isManual);
    const containerAnchor = group.resolvedMembers.find((project) => project.app.isManual);
    const firstMember = group.resolvedMembers[0].member;
    const linkableProject = contentProjects.find((project) => project.app.projectMode === 'app');
    const groupPrimaryAction = !group.isContainer && linkableProject && contentProjects.length === 1
      ? `<button class="icon-button link-project text-sky-500" data-app-id="${escapeHtml(linkableProject.app.id)}" title="${t('linkProgram')}">${icon.link}</button>`
      : `<button class="icon-button merge-project text-sky-500" data-member="${encodeMember(firstMember)}" title="${t('addMergeTitle')}">${icon.merge}</button>`;
    const containerDeleteAction = group.isContainer && containerAnchor
      ? `<button class="icon-button delete-project hover:text-rose-400" data-member="${encodeMember(containerAnchor.member)}" title="${t('deleteProjectTitle')}">${icon.trash}</button>`
      : '';
    const chips = contentProjects.map((project) => {
      const encoded = encodeMember(project.member);
      const ungroupAction = group.isContainer || group.resolvedMembers.length > 1 ? `<button class="ungroup-project grid h-5 w-5 place-items-center rounded text-violet-400 hover:bg-violet-400/10 hover:text-white" data-group-id="${escapeHtml(group.id)}" data-member="${encoded}" title="${t('leaveMergeTitle')}">−</button>` : '';
      const appDisplayName = project.app.isManual ? t('manualProject') : project.app.name;
      return `<span class="inline-flex items-center gap-1 rounded-lg border border-violet-500/10 bg-violet-500/[0.06] py-1 pl-2.5 pr-1 text-[11px] text-violet-300"><span>${escapeHtml(project.name === 'Без отдельного файла' ? t('noFile') : project.name)}</span><span class="text-violet-500/60">· ${escapeHtml(appDisplayName)}</span>${ungroupAction}<button class="delete-project grid h-5 w-5 place-items-center rounded text-slate-600 hover:bg-rose-400/10 hover:text-rose-400" data-member="${encoded}" title="${t('deleteProjectTitle')}">×</button></span>`;
    }).join('');
    const linkChips = (state.projectLinks || []).filter((link) => group.members.some((member) => sameMember(member, link.target))).map((link) => {
      const sourceApp = state.apps.find((app) => app.id === link.sourceAppId);
      if (!sourceApp) return '';
      return `<button class="link-project inline-flex items-center gap-1.5 rounded-lg border ${link.enabled ? 'border-emerald-500/15 bg-emerald-500/[0.06] text-emerald-400' : 'border-slate-800 bg-black/10 text-slate-500'} px-2.5 py-1 text-[11px]" data-app-id="${escapeHtml(sourceApp.id)}" title="${t('linkProgram')}">${icon.link}<span>${escapeHtml(sourceApp.name)}</span><span class="text-[9px] uppercase">${link.enabled ? t('activeLink') : t('pausedLink')}</span></button>`;
    }).join('');
    const groupSubtitle = group.isContainer
      ? contentProjects.length ? t('containerContents', { count: contentProjects.length, date: formatDate(group.lastUsed) }) : t('emptyContainer')
      : t('lastChange', { count: group.resolvedMembers.length, date: formatDate(group.lastUsed) });
    return `<div class="border-b border-slate-800/60 bg-violet-500/[0.015] px-5 py-4 last:border-0">
      <div class="flex items-center gap-4"><div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-400"><svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 7h8M8 12h8M8 17h8"/><circle cx="5" cy="7" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17" r="1"/></svg></div><div class="min-w-0 flex-1"><div class="flex items-center gap-2"><div class="truncate text-sm font-semibold text-white">${escapeHtml(group.name || t('mergedProject'))}</div><button class="rename-project-group text-slate-600 transition hover:text-sky-400" data-group-id="${escapeHtml(group.id)}" title="${t('renameTitle')}">${icon.pencil}</button></div><div class="mt-0.5 text-[11px] text-slate-600">${groupSubtitle}</div></div><div class="text-right"><div class="font-mono text-sm font-semibold text-violet-300">${formatDuration(group.seconds)}</div><div class="mt-0.5 text-[10px] text-slate-600">${t('totalTime')}</div>${coinValue(group.seconds, 'justify-end')}</div><div class="flex">${groupPrimaryAction}${containerDeleteAction}</div></div>
      ${chips || linkChips ? `<div class="mt-3 flex flex-wrap gap-2 pl-14">${chips}${linkChips}</div>` : ''}
    </div>`;
  }).join('');
}

function renderOverview() {
  const projects = flatProjects();
  renderCurrentActivity(projects);

  const visibleApps = state.apps.filter((app) => !app.isManual);
  const filterSignature = JSON.stringify([language(), ...visibleApps.map((app) => [app.id, app.name])]);
  if (elements.appFilter.dataset.signature !== filterSignature) {
    elements.appFilter.innerHTML = [`<option value="all">${t('allApps')}</option>`, ...visibleApps.map((app) => `<option value="${escapeHtml(app.id)}">${escapeHtml(app.name)}</option>`)].join('');
    elements.appFilter.dataset.signature = filterSignature;
  }
  if (!visibleApps.some((app) => app.id === selectedApp)) selectedApp = 'all';
  if (document.activeElement !== elements.appFilter) elements.appFilter.value = selectedApp;
  const selectedTrackedApp = state.apps.find((app) => app.id === selectedApp && app.projectMode === 'tracked-file');
  elements.createEmptyProjectButton.title = t('createEmptyProject');
  elements.addProjectFileButton.classList.toggle('hidden', !selectedTrackedApp);
  if (selectedTrackedApp) elements.addProjectFileButton.title = t('addTrackedFileTitle');
  const loadMore = state.pagination?.hasMore
    ? `<div class="p-4 text-center"><button class="load-more-projects secondary-button" type="button">${t('loadMore')} (${state.pagination.offset + state.pagination.limit}/${state.pagination.total})</button></div>`
    : '';
  elements.projectList.innerHTML = `${renderProjectRows(projects)}${loadMore}`;
}

function renderApps() {
  const visibleApps = state.apps.filter((app) => !app.isManual);
  elements.appList.innerHTML = visibleApps.length ? visibleApps.map((app) => {
    const stats = state.statistics[app.id] || { totalSeconds: 0, projects: {} };
    const extensions = app.extensions?.length ? app.extensions.map((item) => `.${item}`).join(', ') : t('byWindowTitle');
    return `<div class="flex items-center gap-4 border-b border-slate-800/60 px-5 py-4 last:border-0 ${editingAppId === app.id ? 'bg-sky-500/[0.04]' : ''}"><div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/10 font-semibold text-sky-400">${escapeHtml(app.name.slice(0, 1).toUpperCase())}</div><div class="min-w-0 flex-1"><div class="text-sm font-medium text-white">${escapeHtml(app.name)}</div><div class="mt-1 truncate text-[11px] text-slate-600">${t('processLine', { process: escapeHtml(app.processName), extensions: escapeHtml(extensions) })}</div></div><div class="text-right"><div class="font-mono text-sm font-medium text-slate-300">${formatDuration(stats.totalSeconds)}</div><div class="mt-0.5 text-[10px] text-slate-600">${t('projectCount', { count: Object.keys(stats.projects || {}).length })}</div></div><button class="icon-button edit-app hover:text-sky-400" data-id="${escapeHtml(app.id)}" title="${t('editTitle')}"><svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.5 7l3.5 3.5"/></svg></button><button class="icon-button remove-app hover:text-rose-400" data-id="${escapeHtml(app.id)}" title="${t('deleteTitle')}">${icon.trash}</button></div>`;
  }).join('') : `<div class="p-10 text-center text-sm text-slate-600">${t('addFirstApp')}</div>`;
}

function renderSettings() {
  if (!settingsFormDirty) {
    elements.pollInterval.value = state.settings.pollIntervalSeconds;
    elements.idleTimeout.value = state.settings.idleTimeoutMinutes;
    elements.languageSelect.value = language();
    elements.launchAtStartup.checked = Boolean(state.settings.launchAtStartup);
    elements.hourlyRate.value = state.settings.hourlyRate;
  }
  elements.mainDataPath.textContent = state.dataFile;
  elements.backupDataPath.textContent = state.backupFile;
  const status = dataActionMessage || (state.recoveredFromBackup ? { key: 'recoveredBackup', type: 'warning' } : null);
  elements.dataActionStatus.classList.toggle('hidden', !status);
  if (status) {
    elements.dataActionStatus.textContent = status.text || t(status.key);
    elements.dataActionStatus.className = `rounded-lg px-3 py-2 text-xs ${status.type === 'error' ? 'bg-rose-500/10 text-rose-400' : status.type === 'warning' ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-400'}`;
  }
}

function renderStatus() {
  elements.trackingToggle.innerHTML = state.trackingEnabled ? `${icon.pause}<span>${t('pause')}</span>` : `${icon.play}<span>${t('resume')}</span>`;
  const databaseStatus = state.health?.database?.status;
  const warning = !state.platformSupported
    ? t('unsupported')
    : state.monitorError ? t('monitorFailed', { details: state.monitorError })
      : databaseStatus && !['clean', 'closed'].includes(databaseStatus) ? t('databaseFailed', { state: databaseStatus }) : null;
  elements.unsupportedWarning.classList.toggle('hidden', !warning);
  if (warning) elements.unsupportedWarning.textContent = warning;
  if (state.monitorError) {
    elements.sidebarStatus.innerHTML = `<div class="flex items-center gap-2 text-xs font-medium text-rose-400"><span class="h-2 w-2 rounded-full bg-rose-400"></span>${t('monitorFailureStatus')}</div><div class="mt-2 text-[11px] text-slate-600">${t('monitorFailureShort')}</div>`;
  } else if (state.currentActivity) {
    elements.sidebarStatus.innerHTML = `<div class="flex items-center gap-2 text-xs font-medium text-emerald-400">${icon.pulse} ${t('tracking')}</div><div class="mt-2 truncate text-[11px] text-slate-500">${escapeHtml(state.currentActivity.projectName === 'Без отдельного файла' ? t('noFile') : state.currentActivity.projectName)}</div>`;
  } else {
    elements.sidebarStatus.innerHTML = `<div class="flex items-center gap-2 text-xs font-medium ${state.trackingEnabled ? 'text-slate-400' : 'text-amber-400'}"><span class="h-2 w-2 rounded-full ${state.trackingEnabled ? 'bg-slate-600' : 'bg-amber-400'}"></span>${state.trackingEnabled ? t('waiting') : t('onPause')}</div><div class="mt-2 text-[11px] text-slate-600">${state.trackingEnabled ? t('monitoringActive') : t('notRecording')}</div>`;
  }
}

function renderProjectModeControls() {
  const mode = elements.projectMode.value;
  const parts = splitWindowTitle(lastDetectedTitle);
  elements.titleSegmentPicker.classList.toggle('hidden', mode !== 'title-segment' || !parts.length);
  if (mode === 'file') {
    elements.projectModeHint.textContent = t('fileModeHint');
    return;
  }
  if (mode === 'tracked-file') {
    elements.projectModeHint.textContent = t('trackedFileModeHint');
    return;
  }
  if (mode === 'app') {
    elements.projectModeHint.textContent = t('appModeHint');
    return;
  }
  if (!parts.length) {
    elements.projectModeHint.textContent = t('noTitleHint');
    elements.titleSegments.innerHTML = '';
    elements.projectPreview.textContent = '';
    return;
  }
  elements.projectModeHint.textContent = t('segmentModeHint');
  const selectedFromEnd = Math.max(1, Number(elements.titleSegmentFromEnd.value) || 2);
  elements.titleSegments.innerHTML = parts.map((part, index) => {
    const fromEnd = parts.length - index;
    const selected = fromEnd === selectedFromEnd;
    return `<button class="title-segment-option rounded-lg border px-2.5 py-1.5 text-[11px] transition ${selected ? 'border-sky-400/40 bg-sky-400/15 text-sky-300' : 'border-slate-700 bg-black/10 text-slate-400 hover:border-slate-600 hover:text-white'}" data-from-end="${fromEnd}" type="button">${escapeHtml(part)}</button>`;
  }).join('');
  const selectedPart = parts[parts.length - selectedFromEnd] || parts[0];
  elements.projectPreview.textContent = t('preview', { name: selectedPart });
}

function render() {
  if (!state) return;
  if (activePage === 'overview') renderOverview();
  if (activePage === 'apps') {
    renderApps();
    renderProjectModeControls();
  }
  if (activePage === 'settings') renderSettings();
  renderStatus();
  if (mergeSource && !resolveMember(mergeSource)) closeMergeModal();
  if (linkSourceAppId) renderLinkModal();
  if (renamingGroupId && renamingGroupId !== CREATE_EMPTY_PROJECT && !(state.projectGroups || []).some((group) => group.id === renamingGroupId)) closeRenameGroupModal();
  localizeDocument();
}

function interactionBlocksRender() {
  const activeElement = document.activeElement;
  const editingField = ['SELECT', 'INPUT', 'TEXTAREA'].includes(activeElement?.tagName)
    && !activeElement.closest('.hidden');
  return !document.hasFocus()
    || editingField
    || !elements.mergeModal.classList.contains('hidden')
    || !elements.linkModal.classList.contains('hidden')
    || !elements.renameGroupModal.classList.contains('hidden')
    || !elements.confirmModal.classList.contains('hidden');
}

function flushDeferredRender() {
  if (!deferredStateRender || interactionBlocksRender()) return;
  deferredStateRender = false;
  render();
}

function setModalVisibility(modal, isOpen) {
  modal.hidden = !isOpen;
  modal.classList.toggle('hidden', !isOpen);
  modal.classList.toggle('flex', isOpen);
  modal.style.pointerEvents = isOpen ? 'auto' : 'none';
  modal.setAttribute('aria-hidden', String(!isOpen));
}

function closeConfirmModal(result = false) {
  if (elements.confirmModal.contains(document.activeElement)) document.activeElement.blur();
  setModalVisibility(elements.confirmModal, false);
  const resolve = confirmResolver;
  confirmResolver = null;
  if (resolve) resolve(result);
  setTimeout(flushDeferredRender, 0);
}

function confirmAction(messageText) {
  if (confirmResolver) closeConfirmModal(false);
  elements.confirmMessage.textContent = messageText;
  setModalVisibility(elements.confirmModal, true);
  requestAnimationFrame(() => elements.confirmActionButton.focus());
  return new Promise((resolve) => { confirmResolver = resolve; });
}

function errorMessage(error) {
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function showFormError(error) {
  elements.formError.textContent = errorMessage(error);
  elements.formError.classList.remove('hidden');
}

function applyDetectedProgram(program, description) {
  if (!program) return;
  elements.processNameInput.value = program.processName || '';
  elements.executablePathInput.value = program.executablePath || '';
  if (!elements.appNameInput.value.trim()) elements.appNameInput.value = program.suggestedName || program.processName || '';
  lastDetectedTitle = program.title || '';
  elements.detectedSource.textContent = description;
  elements.detectedSource.classList.remove('hidden');
  elements.formError.classList.add('hidden');
  renderProjectModeControls();
}

function resetAppForm() {
  editingAppId = null;
  lastDetectedTitle = '';
  document.querySelector('#add-app-form').reset();
  elements.appFormTitle.textContent = t('addApp');
  elements.appFormSubtitle.textContent = t('exampleApp');
  elements.appSubmitButton.textContent = t('addTracking');
  elements.cancelEditButton.classList.add('hidden');
  elements.detectedSource.classList.add('hidden');
  elements.formError.classList.add('hidden');
  renderProjectModeControls();
  localizeDocument();
  renderApps();
}

function beginAppEdit(id) {
  const trackedApp = state.apps.find((app) => app.id === id);
  if (!trackedApp) return;
  editingAppId = id;
  elements.appNameInput.value = trackedApp.name;
  elements.processNameInput.value = trackedApp.processName;
  elements.executablePathInput.value = trackedApp.executablePath || '';
  elements.extensionsInput.value = (trackedApp.extensions || []).join(', ');
  elements.projectMode.value = trackedApp.projectMode || 'file';
  elements.titleSegmentFromEnd.value = trackedApp.titleSegmentFromEnd || 2;
  lastDetectedTitle = state.currentActivity?.appId === id ? state.currentActivity.windowTitle : '';
  elements.appFormTitle.textContent = t('editApp');
  elements.appFormSubtitle.textContent = t('statsPreserved');
  elements.appSubmitButton.textContent = t('saveChanges');
  elements.cancelEditButton.classList.remove('hidden');
  elements.detectedSource.classList.add('hidden');
  elements.formError.classList.add('hidden');
  renderApps();
  renderProjectModeControls();
  localizeDocument();
  elements.appNameInput.focus();
}

function closeMergeModal() {
  if (elements.mergeModal.contains(document.activeElement)) document.activeElement.blur();
  mergeSource = null;
  setModalVisibility(elements.mergeModal, false);
  setTimeout(flushDeferredRender, 0);
}

function openMergeModal(source) {
  mergeSource = source;
  const projects = flatProjects();
  const projectLookup = new Map(projects.map((project) => [memberKey(project.member), project]));
  const sourceProject = resolveMember(source, projects);
  const sourceGroup = groupFor(source);
  const excluded = sourceGroup?.members || [source];
  const seenGroups = new Set();
  const candidates = [];

  for (const project of projects) {
    if (excluded.some((member) => sameMember(member, project.member))) continue;
    const candidateGroup = groupFor(project.member);
    if (candidateGroup) {
      if (sourceGroup?.isContainer && candidateGroup.isContainer) continue;
      if (seenGroups.has(candidateGroup.id)) continue;
      seenGroups.add(candidateGroup.id);
      const details = groupDetails(candidateGroup, projects, projectLookup);
      const contentProjects = details.resolvedMembers.filter((item) => !item.app.isManual);
      candidates.push({ member: details.resolvedMembers[0].member, name: candidateGroup.isContainer ? candidateGroup.name : details.resolvedMembers.map((item) => item.name === 'Без отдельного файла' ? t('noFile') : item.name).join(' + '), appName: candidateGroup.isContainer ? (contentProjects.length ? t('containerContents', { count: contentProjects.length, date: formatDate(details.lastUsed) }) : t('emptyContainer')) : t('combinedCount', { count: details.resolvedMembers.length }), seconds: details.seconds });
    } else {
        candidates.push({ member: project.member, name: project.name === 'Без отдельного файла' ? t('noFile') : project.name, appName: appDisplayName(project.app), seconds: project.seconds });
    }
  }

  elements.mergeCaption.textContent = sourceGroup ? t('mergeCaptionAdd') : t('mergeCaptionChoose', { name: sourceProject?.name || source.projectName });
  elements.mergeProjectList.innerHTML = candidates.length ? candidates.map((candidate) => `<button class="merge-target flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/5" data-member="${encodeMember(candidate.member)}"><span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-400">${icon.merge}</span><span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-slate-200">${escapeHtml(candidate.name)}</span><span class="mt-0.5 block text-[11px] text-slate-600">${escapeHtml(candidate.appName)}</span></span><span class="font-mono text-xs text-slate-500">${formatDuration(candidate.seconds)}</span></button>`).join('') : `<div class="px-4 py-10 text-center text-sm text-slate-600">${t('noMergeTargets')}</div>`;
  setModalVisibility(elements.mergeModal, true);
}

function closeLinkModal() {
  if (elements.linkModal.contains(document.activeElement)) document.activeElement.blur();
  linkSourceAppId = null;
  setModalVisibility(elements.linkModal, false);
  setTimeout(flushDeferredRender, 0);
}

function renderLinkModal() {
  const sourceApp = state.apps.find((app) => app.id === linkSourceAppId);
  if (!sourceApp) return closeLinkModal();
  const projects = flatProjects();
  const links = (state.projectLinks || []).filter((link) => link.sourceAppId === sourceApp.id);
  elements.linkCaption.textContent = t('linksFor', { name: sourceApp.name });
  elements.linkExistingList.innerHTML = links.length ? links.map((link) => {
    const targetProject = resolveMember(link.target, projects);
    const targetGroup = groupFor(link.target);
    const targetName = targetGroup?.name || targetProject?.name || t('linkTargetMissing');
    const targetApp = targetProject ? appDisplayName(targetProject.app) : '';
    const linkIsActive = link.enabled && Boolean(targetProject);
    return `<div class="flex items-center gap-3 rounded-xl border ${linkIsActive ? 'border-emerald-500/20 bg-emerald-500/[0.04]' : 'border-slate-800 bg-black/10'} px-3 py-3"><span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg ${linkIsActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-500'}">${icon.link}</span><span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-slate-200">${escapeHtml(targetName)}</span><span class="mt-0.5 block text-[11px] text-slate-600">${escapeHtml(targetApp)} · ${linkIsActive ? t('activeLink') : t('pausedLink')} · ${formatDuration(link.seconds)}</span></span>${targetProject ? `<button class="toggle-project-link icon-button ${linkIsActive ? 'text-amber-400' : 'text-emerald-400'}" data-link-id="${escapeHtml(link.id)}" data-enabled="${linkIsActive ? 'false' : 'true'}" title="${linkIsActive ? t('pause') : t('resume')}">${linkIsActive ? icon.pause : icon.play}</button>` : ''}<button class="remove-project-link icon-button hover:text-rose-400" data-link-id="${escapeHtml(link.id)}" title="${t('deleteTitle')}">${icon.trash}</button></div>`;
  }).join('') : `<div class="rounded-xl bg-black/10 px-4 py-6 text-center text-sm text-slate-600">${t('noLinks')}</div>`;

  const linkedTargets = new Set(links.map((link) => memberKey(link.target)));
  const seenGroups = new Set();
  const candidates = [];
  for (const project of projects) {
    if (project.app.id === sourceApp.id || linkedTargets.has(memberKey(project.member))) continue;
    const group = groupFor(project.member);
    if (group) {
      if (seenGroups.has(group.id)) continue;
      seenGroups.add(group.id);
      const details = groupDetails(group, projects);
      const member = details.resolvedMembers[0]?.member;
      const contentCount = details.resolvedMembers.filter((item) => !item.app.isManual).length;
      if (member && !linkedTargets.has(memberKey(member))) candidates.push({ member, name: group.name || t('mergedProject'), appName: group.isContainer ? (contentCount ? t('containerContents', { count: contentCount, date: formatDate(details.lastUsed) }) : t('emptyContainer')) : t('combinedCount', { count: details.resolvedMembers.length }) });
    } else {
      candidates.push({ member: project.member, name: project.name, appName: appDisplayName(project.app) });
    }
  }
  elements.linkProjectList.innerHTML = candidates.length ? candidates.map((candidate) => `<button class="add-project-link flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/5" data-member="${encodeMember(candidate.member)}"><span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-400">${icon.link}</span><span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-slate-200">${escapeHtml(candidate.name)}</span><span class="mt-0.5 block text-[11px] text-slate-600">${escapeHtml(candidate.appName)}</span></span></button>`).join('') : `<div class="px-4 py-8 text-center text-sm text-slate-600">${t('noMergeTargets')}</div>`;
}

function openLinkModal(appId) {
  linkSourceAppId = appId;
  renderLinkModal();
  setModalVisibility(elements.linkModal, true);
}

function closeRenameGroupModal() {
  if (elements.renameGroupModal.contains(document.activeElement)) document.activeElement.blur();
  renamingGroupId = null;
  setModalVisibility(elements.renameGroupModal, false);
  elements.renameGroupError.classList.add('hidden');
  setTimeout(flushDeferredRender, 0);
}

function openRenameGroupModal(groupId) {
  const group = (state.projectGroups || []).find((item) => item.id === groupId);
  if (!group) return;
  renamingGroupId = groupId;
  elements.projectNameModalTitle.textContent = t('groupName');
  elements.projectNameModalHelp.textContent = t('groupNameHelp');
  elements.renameGroupInput.value = group.name || '';
  elements.renameGroupError.classList.add('hidden');
  setModalVisibility(elements.renameGroupModal, true);
  requestAnimationFrame(() => {
    elements.renameGroupInput.focus();
    elements.renameGroupInput.select();
  });
}

function openCreateEmptyProjectModal() {
  renamingGroupId = CREATE_EMPTY_PROJECT;
  elements.projectNameModalTitle.textContent = t('createEmptyProject');
  elements.projectNameModalHelp.textContent = t('emptyProjectHelp');
  elements.renameGroupInput.value = '';
  elements.renameGroupError.classList.add('hidden');
  setModalVisibility(elements.renameGroupModal, true);
  requestAnimationFrame(() => elements.renameGroupInput.focus());
}

function mergeProjectPage(page) {
  if (!state) return page;
  const statistics = Object.create(null);
  for (const app of page.apps || []) {
    const previous = state.statistics?.[app.id] || { projects: {} };
    const incoming = page.statistics?.[app.id] || { projects: {} };
    statistics[app.id] = {
      totalSeconds: incoming.totalSeconds,
      projects: { ...(previous.projects || {}), ...(incoming.projects || {}) },
    };
  }
  const groups = new Map((state.projectGroups || []).map((group) => [group.id, group]));
  for (const group of page.projectGroups || []) groups.set(group.id, group);
  return { ...state, ...page, statistics, projectGroups: [...groups.values()] };
}

function applyIntervalDeltas(deltas) {
  for (const delta of deltas || []) {
    const appStats = state.statistics?.[delta.appId];
    if (!appStats) continue;
    const seconds = Math.max(0, Number(delta.durationMs) || 0) / 1000;
    appStats.totalSeconds = (Number(appStats.totalSeconds) || 0) + seconds;
    const project = appStats.projects[delta.projectName] || { seconds: 0, lastUsed: null };
    project.seconds = (Number(project.seconds) || 0) + seconds;
    project.lastUsed = new Date(delta.endWallMs).toISOString();
    appStats.projects[delta.projectName] = project;
    const sourceMember = { appId: delta.appId, projectName: delta.projectName };
    const sourceGroup = groupFor(sourceMember);
    if (sourceGroup) {
      sourceGroup.seconds = (Number(sourceGroup.seconds) || 0) + seconds;
      sourceGroup.lastUsed = project.lastUsed;
    }
    if (delta.link?.id) {
      const link = (state.projectLinks || []).find((item) => item.id === delta.link.id);
      if (link) {
        link.seconds = (Number(link.seconds) || 0) + seconds;
        link.lastUsed = project.lastUsed;
        const targetGroup = groupFor(link.target);
        if (targetGroup) {
          targetGroup.seconds = (Number(targetGroup.seconds) || 0) + seconds;
          targetGroup.lastUsed = project.lastUsed;
        }
      }
    }
  }
}

document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => {
  activePage = button.dataset.page;
  document.querySelectorAll('[data-page]').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelectorAll('main > section[id^="page-"]').forEach((page) => page.classList.toggle('hidden', page.id !== `page-${button.dataset.page}`));
  render();
}));

elements.trackingToggle.addEventListener('click', async () => { state = await window.workTracker.setEnabled(!state.trackingEnabled); render(); });
document.querySelector('#minimize-button').addEventListener('click', () => window.workTracker.minimizeToTray());
elements.appFilter.addEventListener('change', () => { selectedApp = elements.appFilter.value; renderOverview(); });
elements.createEmptyProjectButton.addEventListener('click', openCreateEmptyProjectModal);
elements.addProjectFileButton.addEventListener('click', async () => {
  if (selectedApp === 'all') return;
  state = await window.workTracker.addTrackedFile(selectedApp);
  render();
});
elements.projectMode.addEventListener('change', renderProjectModeControls);
elements.titleSegments.addEventListener('click', (event) => {
  const button = event.target.closest('.title-segment-option');
  if (!button) return;
  elements.titleSegmentFromEnd.value = button.dataset.fromEnd;
  renderProjectModeControls();
});

document.querySelector('#add-app-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  elements.formError.classList.add('hidden');
  const values = Object.fromEntries(new FormData(formElement).entries());
  try {
    state = editingAppId ? await window.workTracker.updateApp(editingAppId, values) : await window.workTracker.addApp(values);
    resetAppForm();
    render();
  } catch (error) {
    showFormError(error);
  }
});

elements.cancelEditButton.addEventListener('click', resetAppForm);
document.querySelector('#active-window-button').addEventListener('click', async () => {
  try {
    const program = await window.workTracker.getLastActiveWindow();
    applyDetectedProgram(program, t('detected', { process: program.processName, title: program.title ? ` — «${program.title}»` : '' }));
  } catch (error) { showFormError(error); }
});
document.querySelector('#choose-exe-button').addEventListener('click', async () => {
  try {
    const program = await window.workTracker.chooseExecutable();
    if (program) applyDetectedProgram(program, t('selectedFile', { path: program.executablePath }));
  } catch (error) { showFormError(error); }
});

elements.appList.addEventListener('click', async (event) => {
  const editButton = event.target.closest('.edit-app');
  if (editButton) return beginAppEdit(editButton.dataset.id);
  const removeButton = event.target.closest('.remove-app');
  if (!removeButton || !await confirmAction(t('confirmApp'))) return;
  state = await window.workTracker.removeApp(removeButton.dataset.id);
  if (editingAppId === removeButton.dataset.id) resetAppForm();
  render();
});

elements.projectList.addEventListener('click', async (event) => {
  const loadMoreButton = event.target.closest('.load-more-projects');
  if (loadMoreButton) {
    loadMoreButton.disabled = true;
    try {
      const nextOffset = (state.pagination?.offset || 0) + (state.pagination?.limit || 250);
      const page = await window.workTracker.getProjectPage(nextOffset, state.pagination?.limit || 250);
      state = mergeProjectPage(page);
      state.pagination.offset = nextOffset;
      render();
    } catch (error) {
      showFormError(error);
    }
    return;
  }
  const linkButton = event.target.closest('.link-project');
  if (linkButton) return openLinkModal(linkButton.dataset.appId);
  const fileButton = event.target.closest('.add-file-for-app');
  if (fileButton) {
    state = await window.workTracker.addTrackedFile(fileButton.dataset.appId);
    return render();
  }
  const renameButton = event.target.closest('.rename-project-group');
  if (renameButton) return openRenameGroupModal(renameButton.dataset.groupId);
  const mergeButton = event.target.closest('.merge-project');
  if (mergeButton) return openMergeModal(decodeMember(mergeButton.dataset.member));
  const ungroupButton = event.target.closest('.ungroup-project');
  if (ungroupButton) {
    state = await window.workTracker.ungroupProject(ungroupButton.dataset.groupId, decodeMember(ungroupButton.dataset.member));
    return render();
  }
  const deleteButton = event.target.closest('.delete-project');
  if (!deleteButton || !await confirmAction(t('confirmProject'))) return;
  state = await window.workTracker.deleteProject(decodeMember(deleteButton.dataset.member));
  render();
});

elements.mergeProjectList.addEventListener('click', async (event) => {
  const targetButton = event.target.closest('.merge-target');
  if (!targetButton || !mergeSource) return;
  state = await window.workTracker.mergeProjects(mergeSource, decodeMember(targetButton.dataset.member));
  closeMergeModal();
  render();
});
document.querySelector('#merge-cancel-button').addEventListener('click', closeMergeModal);
elements.mergeModal.addEventListener('click', (event) => { if (event.target === elements.mergeModal) closeMergeModal(); });

elements.linkExistingList.addEventListener('click', async (event) => {
  const toggleButton = event.target.closest('.toggle-project-link');
  if (toggleButton) {
    state = await window.workTracker.setProjectLinkEnabled(toggleButton.dataset.linkId, toggleButton.dataset.enabled === 'true');
    render();
    return;
  }
  const removeButton = event.target.closest('.remove-project-link');
  if (!removeButton) return;
  state = await window.workTracker.removeProjectLink(removeButton.dataset.linkId);
  render();
});
elements.linkProjectList.addEventListener('click', async (event) => {
  const addButton = event.target.closest('.add-project-link');
  if (!addButton || !linkSourceAppId) return;
  state = await window.workTracker.addProjectLink(linkSourceAppId, decodeMember(addButton.dataset.member));
  render();
});
document.querySelector('#link-cancel-button').addEventListener('click', closeLinkModal);
elements.linkModal.addEventListener('click', (event) => { if (event.target === elements.linkModal) closeLinkModal(); });

elements.renameGroupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!renamingGroupId) return;
  elements.renameGroupError.classList.add('hidden');
  try {
    state = renamingGroupId === CREATE_EMPTY_PROJECT
      ? await window.workTracker.createEmptyProject(elements.renameGroupInput.value)
      : await window.workTracker.renameProjectGroup(renamingGroupId, elements.renameGroupInput.value);
    closeRenameGroupModal();
    render();
  } catch (error) {
    elements.renameGroupError.textContent = errorMessage(error);
    elements.renameGroupError.classList.remove('hidden');
  }
});
document.querySelector('#rename-group-cancel-button').addEventListener('click', closeRenameGroupModal);
document.querySelector('#rename-group-secondary-cancel').addEventListener('click', closeRenameGroupModal);
elements.renameGroupModal.addEventListener('click', (event) => { if (event.target === elements.renameGroupModal) closeRenameGroupModal(); });

elements.settingsForm.addEventListener('input', () => { settingsFormDirty = true; });
elements.settingsForm.addEventListener('change', () => { settingsFormDirty = true; });
elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.settingsError.classList.add('hidden');
  const submittedSettings = {
    language: elements.languageSelect.value,
    launchAtStartup: elements.launchAtStartup.checked,
    pollIntervalSeconds: elements.pollInterval.value,
    idleTimeoutMinutes: elements.idleTimeout.value,
    hourlyRate: elements.hourlyRate.value,
  };
  try {
    const previousLanguage = language();
    const updatedState = await window.workTracker.updateSettings(submittedSettings);
    settingsFormDirty = false;
    state = updatedState;
    if (language() !== previousLanguage) {
      window.location.reload();
      return;
    }
    render();
  } catch (error) {
    elements.settingsError.textContent = errorMessage(error);
    elements.settingsError.classList.remove('hidden');
  }
});

document.querySelector('#create-backup-button').addEventListener('click', async () => {
  try {
    state = await window.workTracker.createBackup();
    dataActionMessage = { key: 'backupCreated', type: 'success' };
  } catch (error) {
    dataActionMessage = { text: errorMessage(error), type: 'error' };
  }
  renderSettings();
  localizeDocument();
});

document.querySelector('#open-data-folder-button').addEventListener('click', async () => {
  try {
    await window.workTracker.openDataFolder();
    dataActionMessage = { key: 'folderOpened', type: 'success' };
  } catch (error) {
    dataActionMessage = { text: errorMessage(error), type: 'error' };
  }
  renderSettings();
  localizeDocument();
});

document.querySelector('#clear-button').addEventListener('click', async () => {
  if (!await confirmAction(t('confirmClear'))) return;
  state = await window.workTracker.clearStatistics();
  render();
});

function restoreInteractionState() {
  setModalVisibility(elements.mergeModal, Boolean(mergeSource));
  setModalVisibility(elements.linkModal, Boolean(linkSourceAppId));
  setModalVisibility(elements.renameGroupModal, Boolean(renamingGroupId));
  setModalVisibility(elements.confirmModal, Boolean(confirmResolver));
  document.documentElement.style.pointerEvents = '';
  document.body.style.pointerEvents = '';
  setTimeout(flushDeferredRender, 0);
}

setModalVisibility(elements.mergeModal, false);
setModalVisibility(elements.linkModal, false);
setModalVisibility(elements.renameGroupModal, false);
setModalVisibility(elements.confirmModal, false);
document.querySelector('#confirm-cancel-button').addEventListener('click', () => closeConfirmModal(false));
elements.confirmActionButton.addEventListener('click', () => closeConfirmModal(true));
elements.confirmModal.addEventListener('click', (event) => { if (event.target === elements.confirmModal) closeConfirmModal(false); });
document.addEventListener('focusout', () => setTimeout(flushDeferredRender, 0));
document.addEventListener('change', () => setTimeout(flushDeferredRender, 0));
window.addEventListener('focus', restoreInteractionState);
document.addEventListener('visibilitychange', () => { if (!document.hidden) restoreInteractionState(); });

window.workTracker.onState((nextState) => {
  state = state ? mergeProjectPage(nextState) : nextState;
  if (interactionBlocksRender()) deferredStateRender = true;
  else if (activePage === 'overview') render();
  else {
    renderStatus();
    localizeDocument();
  }
});
window.workTracker.onRuntime((runtime) => {
  if (!state) return;
  applyIntervalDeltas(runtime.intervalDeltas);
  state = { ...state, ...runtime };
  if (interactionBlocksRender()) deferredStateRender = true;
  else {
    renderCurrentActivity();
    renderStatus();
    if (activePage === 'overview' && runtime.intervalDeltas?.length && Date.now() - lastOverviewTotalsRenderAt >= 5000) {
      lastOverviewTotalsRenderAt = Date.now();
      renderOverview();
    }
  }
});
window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  elements.unsupportedWarning.textContent = errorMessage(event.reason);
  elements.unsupportedWarning.classList.remove('hidden');
});
window.workTracker.getState()
  .then((initialState) => { state = initialState; render(); })
  .catch((error) => {
    elements.unsupportedWarning.textContent = errorMessage(error);
    elements.unsupportedWarning.classList.remove('hidden');
  });
