/**
 * Tab-Specific Storage Manager
 * 
 * Provides isolated storage per browser tab using sessionStorage,
 * with optional localStorage templates for configuration sharing.
 */

// Generate unique tab ID for this session
const generateTabId = (): string => {
  return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Get or create tab ID for this session
const getTabId = (): string => {
  let tabId = sessionStorage.getItem('__tab_id');
  if (!tabId) {
    tabId = generateTabId();
    sessionStorage.setItem('__tab_id', tabId);
  }
  return tabId;
};

export interface ConfigTemplate {
  id: string;
  name: string;
  description?: string;
  config: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

class TabStorageManager {
  private tabId: string;

  constructor() {
    this.tabId = getTabId();
  }

  /**
   * Get current tab ID
   */
  getTabId(): string {
    return this.tabId;
  }

  /**
   * Set item in tab-specific storage (sessionStorage)
   */
  setItem(key: string, value: string): void {
    sessionStorage.setItem(key, value);
  }

  /**
   * Get item from tab-specific storage (sessionStorage)
   */
  getItem(key: string): string | null {
    return sessionStorage.getItem(key);
  }

  /**
   * Remove item from tab-specific storage
   */
  removeItem(key: string): void {
    sessionStorage.removeItem(key);
  }

  /**
   * Clear all tab-specific storage
   */
  clear(): void {
    // Don't clear the tab ID itself
    const currentTabId = this.tabId;
    sessionStorage.clear();
    sessionStorage.setItem('__tab_id', currentTabId);
  }

  /**
   * Set JSON object in tab storage
   */
  setObject<T>(key: string, value: T): void {
    this.setItem(key, JSON.stringify(value));
  }

  /**
   * Get JSON object from tab storage
   */
  getObject<T>(key: string): T | null {
    const item = this.getItem(key);
    if (!item) return null;
    try {
      return JSON.parse(item) as T;
    } catch (error) {
      console.error('Failed to parse JSON from storage:', error);
      return null;
    }
  }

  // ===== TEMPLATE MANAGEMENT (localStorage) =====

  /**
   * Save current tab configuration as a template
   */
  saveAsTemplate(name: string, description?: string): string {
    const templateId = `template_${Date.now()}`;
    const config = this.exportTabConfig();
    
    const template: ConfigTemplate = {
      id: templateId,
      name,
      description,
      config,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const templates = this.getTemplates();
    templates[templateId] = template;
    localStorage.setItem('config_templates', JSON.stringify(templates));
    
    return templateId;
  }

  /**
   * Load template into current tab
   */
  loadTemplate(templateId: string): boolean {
    const templates = this.getTemplates();
    const template = templates[templateId];
    
    if (!template) {
      console.error('Template not found:', templateId);
      return false;
    }

    this.importTabConfig(template.config);
    return true;
  }

  /**
   * Get all available templates
   */
  getTemplates(): Record<string, ConfigTemplate> {
    const stored = localStorage.getItem('config_templates');
    if (!stored) return {};
    
    try {
      return JSON.parse(stored);
    } catch (error) {
      console.error('Failed to parse templates:', error);
      return {};
    }
  }

  /**
   * Delete a template
   */
  deleteTemplate(templateId: string): boolean {
    const templates = this.getTemplates();
    if (!templates[templateId]) {
      return false;
    }

    delete templates[templateId];
    localStorage.setItem('config_templates', JSON.stringify(templates));
    
    // If this was the default template, clear it
    if (this.getDefaultTemplateId() === templateId) {
      this.setDefaultTemplate(null);
    }
    return true;
  }

  /**
   * Update template
   */
  updateTemplate(templateId: string, updates: Partial<Pick<ConfigTemplate, 'name' | 'description'>>): boolean {
    const templates = this.getTemplates();
    const template = templates[templateId];
    
    if (!template) {
      return false;
    }

    templates[templateId] = {
      ...template,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    localStorage.setItem('config_templates', JSON.stringify(templates));
    return true;
  }

  // ===== CONFIG EXPORT/IMPORT =====

  /**
   * Export all current tab configuration
   */
  exportTabConfig(): Record<string, any> {
    const config: Record<string, any> = {};
    
    // Export all sessionStorage items except internal ones
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && !key.startsWith('__')) {
        const value = sessionStorage.getItem(key);
        if (value) {
          try {
            // Try to parse as JSON, fall back to string
            config[key] = JSON.parse(value);
          } catch {
            config[key] = value;
          }
        }
      }
    }

    return config;
  }

  /**
   * Import configuration into current tab
   */
  importTabConfig(config: Record<string, any>): void {
    // Clear current config but keep tab ID
    const currentTabId = this.tabId;
    this.clear();
    
    // Import new config
    Object.entries(config).forEach(([key, value]) => {
      if (typeof value === 'string') {
        this.setItem(key, value);
      } else {
        this.setObject(key, value);
      }
    });

    // Restore tab ID
    sessionStorage.setItem('__tab_id', currentTabId);
  }

  /**
   * Get configuration summary for display
   */
  getConfigSummary(): Record<string, any> {
    const config = this.exportTabConfig();
    return {
      tabId: this.tabId,
      sipConfig: config.sipConfig || null,
      theme: config.theme || 'light',
      audioDevices: config.audioDevices || null,
      configCount: Object.keys(config).length,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Set or clear the default template
   */
  setDefaultTemplate(templateId: string | null): void {
    if (templateId === null) {
      localStorage.removeItem('defaultTemplateId');
    } else {
      localStorage.setItem('defaultTemplateId', templateId);
    }
  }

  /**
   * Get the default template ID
   */
  getDefaultTemplateId(): string | null {
    return localStorage.getItem('defaultTemplateId');
  }

  /**
   * Load the default template if no configuration exists
   */
  loadDefaultTemplateIfNeeded(): boolean {
    // Check if we already have a configuration in this tab
    const hasConfig = this.getItem('sipConfig') !== null;
    
    if (!hasConfig) {
      const defaultTemplateId = this.getDefaultTemplateId();
      if (defaultTemplateId) {
        console.log('Loading default template:', defaultTemplateId);
        return this.loadTemplate(defaultTemplateId);
      }
    }
    return false;
  }
}

// Export singleton instance
export const tabStorage = new TabStorageManager();

// Helper hooks for React components
export const useTabStorage = () => {
  return {
    storage: tabStorage,
    tabId: tabStorage.getTabId(),
    setItem: (key: string, value: string) => tabStorage.setItem(key, value),
    getItem: (key: string) => tabStorage.getItem(key),
    setObject: <T>(key: string, value: T) => tabStorage.setObject(key, value),
    getObject: <T>(key: string) => tabStorage.getObject<T>(key),
    exportConfig: () => tabStorage.exportTabConfig(),
    importConfig: (config: Record<string, any>) => tabStorage.importTabConfig(config),
    saveAsTemplate: (name: string, description?: string) => tabStorage.saveAsTemplate(name, description),
    loadTemplate: (templateId: string) => tabStorage.loadTemplate(templateId),
    getTemplates: () => tabStorage.getTemplates(),
    deleteTemplate: (templateId: string) => tabStorage.deleteTemplate(templateId),
    setDefaultTemplate: (templateId: string | null) => tabStorage.setDefaultTemplate(templateId),
    getDefaultTemplateId: () => tabStorage.getDefaultTemplateId(),
    loadDefaultTemplateIfNeeded: () => tabStorage.loadDefaultTemplateIfNeeded(),
  };
};