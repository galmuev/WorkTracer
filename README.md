# WorkTracer

[English](README.md) | [Русский](README.ru.md)

<p align="center">
<img width="579" height="386" alt="image" src="https://github.com/user-attachments/assets/14d31e05-a63d-4135-8186-d2701790dd6f" />
</p>

A local work time tracker for Windows. WorkTracer detects the active application, assigns tracked time to projects, and stores all statistics exclusively on the user's computer.

## Features

- Automatic time tracking based on the active window.
- Automatic pause when the user is inactive, with an option to stop tracking manually.
- Separate statistics for applications and projects.
- Grouping related files and projects from different applications into named containers.
- Linking applications that do not expose a document name, such as ZBrush, to a selected working project.
- Calculation of time cost based on a configurable hourly rate.
- System tray integration.
- Automatic startup with Windows directly in the system tray.
- Russian and English user interface.

## Project Detection

A suitable detection mode can be selected for each application:

- **First title segment** — the file name is extracted from the window title using the specified file extensions.
- **Selected title segment** — the selected part of the window title or the working folder name becomes the project name.
- **Tracked file** — files are added manually, and the most recently saved file is considered active. This method may be unreliable.
- **Entire application** — all tracked time is assigned to a single project named after the application.

The **Entire application** mode supports links. An application may have multiple link targets, but only one can be active at a time. While the application is in use, time is recorded in its own statistics and is also assigned to the selected project.

## Getting Started

1. Run the WorkTracer installer or portable version.
2. Open the **Applications** section and add an application using its EXE file, process name, or the **Active Window** button.
3. Select a project detection method and specify file extensions when necessary.
4. Open the application you want to track. Time tracking will start automatically.

Closing the main window minimizes WorkTracer to the system tray. To exit the application completely, select **Exit** from the tray icon context menu.

## Data and Privacy

WorkTracer does not send statistics over the internet. Application names, project names, tracked files, and time intervals are stored in a local SQLite database in the user's profile directory.

The database uses foreign keys, WAL mode, and transactions. The data directory can be opened and a verified backup can be created from the **Settings** section.

Automatic backups are created after changes, with a recovery point objective of up to 15 minutes. WorkTracer retains the ten most recent backup generations and daily backups for seven days. A separate verified backup is created before clearing data or performing bulk deletion operations.

Active-window detection is supported only on Windows. Neither the installed nor the portable version requires a separate Node.js installation.

## Running from Source

```powershell
npm install
npm start
```

Windows builds:

```powershell
npm run pack:win       # release/win-unpacked directory
npm run portable:win   # portable EXE
npm run dist:win       # NSIS installer
```

## Technologies

Electron, Node.js, SQLite (`better-sqlite3`), Tailwind CSS, Windows PowerShell, and the Win32 API.

SQLite is the application's single source of truth for operational data. The database is stored in the user's profile directory and uses foreign keys, WAL mode, transactions, verified multi-generation backups, and automatic recovery after database corruption.

The storage and recovery architecture is described in `docs/sqlite-persistence-design.md`.

Project checks can be run with `npm run quality`; the production build can be created with `npm run pack:win`.

## License

MIT
