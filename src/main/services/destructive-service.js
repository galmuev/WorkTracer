class DestructiveService {
  constructor({ store, backupManager }) {
    this.store = store;
    this.backupManager = backupManager;
  }

  async removeApplication(applicationId) {
    await this.#createBackup('before-remove-application');
    return this.store.removeApplication(applicationId);
  }

  async deleteProject(member) {
    await this.#createBackup('before-remove-project');
    return this.store.deleteProject(member);
  }

  async clearTrackingData() {
    await this.#createBackup('before-clear-data');
    return this.store.clearTrackingData();
  }

  async #createBackup(reason) {
    try {
      await this.backupManager.create(reason);
    } catch (error) {
      if (error && typeof error === 'object' && !error.publicMessage) {
        error.publicMessage = 'Не удалось создать и проверить резервную копию. Изменения не применены.';
      }
      throw error;
    }
  }
}

module.exports = { DestructiveService };
