'use client';

import { useState, useEffect } from 'react';
import { useTabStorage } from '@/utils/tabStorage';
import { TbDeviceFloppy, TbFileDownload, TbTrash, TbStar, TbStarFilled } from 'react-icons/tb';

interface ConfigTemplate {
  name: string;
  description?: string;
  createdAt: string;
  config: any;
}

export default function ConfigTemplates() {
  const { saveAsTemplate, loadTemplate, getTemplates, deleteTemplate, setDefaultTemplate, getDefaultTemplateId } = useTabStorage();
  const [templates, setTemplates] = useState<Record<string, ConfigTemplate>>({});
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info' | null; text: string }>({ type: null, text: '' });
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);

  useEffect(() => {
    loadTemplatesList();
  }, []);

  const loadTemplatesList = () => {
    const allTemplates = getTemplates();
    setTemplates(allTemplates);
    const defaultId = getDefaultTemplateId();
    setDefaultTemplateId(defaultId);
  };

  const handleSaveTemplate = () => {
    if (!templateName.trim()) {
      setMessage({ type: 'error', text: 'Please enter a template name' });
      return;
    }

    try {
      setIsLoading(true);
      const templateId = saveAsTemplate(templateName.trim(), templateDescription.trim() || undefined);
      setMessage({ type: 'success', text: `Template "${templateName}" saved successfully!` });
      setTemplateName('');
      setTemplateDescription('');
      loadTemplatesList();
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save template' });
      console.error('Error saving template:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadTemplate = (templateId: string) => {
    try {
      setIsLoading(true);
      const success = loadTemplate(templateId);
      if (success) {
        setMessage({ type: 'success', text: `Template loaded! Refreshing page to apply changes...` });
        // Reload the page to ensure all components pick up the new configuration
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        setMessage({ type: 'error', text: 'Failed to load template' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to load template' });
      console.error('Error loading template:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTemplate = (templateId: string) => {
    if (!confirm('Are you sure you want to delete this template?')) {
      return;
    }

    try {
      deleteTemplate(templateId);
      setMessage({ type: 'info', text: 'Template deleted' });
      loadTemplatesList();
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to delete template' });
      console.error('Error deleting template:', error);
    }
  };

  const handleSetDefault = (templateId: string) => {
    try {
      setDefaultTemplate(templateId);
      setDefaultTemplateId(templateId);
      setMessage({ type: 'success', text: 'Default template set successfully!' });
      loadTemplatesList();
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to set default template' });
      console.error('Error setting default template:', error);
    }
  };

  const handleClearDefault = () => {
    try {
      setDefaultTemplate(null);
      setDefaultTemplateId(null);
      setMessage({ type: 'info', text: 'Default template cleared' });
      loadTemplatesList();
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to clear default template' });
      console.error('Error clearing default template:', error);
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h3 className="card-title mb-4">Configuration Templates</h3>
        
        {message.type && (
          <div className={`alert alert-${message.type === 'error' ? 'error' : message.type === 'success' ? 'success' : 'info'} mb-4`}>
            <span>{message.text}</span>
          </div>
        )}

        {/* Save Current Configuration */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold mb-2">Save Current Configuration as Template</h4>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Template name (e.g., 'Production Server', 'Test User 1001')"
              className="input input-bordered w-full"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              disabled={isLoading}
            />
            <textarea
              placeholder="Optional description"
              className="textarea textarea-bordered w-full"
              rows={2}
              value={templateDescription}
              onChange={(e) => setTemplateDescription(e.target.value)}
              disabled={isLoading}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSaveTemplate}
              disabled={isLoading || !templateName.trim()}
            >
              <TbDeviceFloppy className="w-4 h-4" />
              Save as Template
            </button>
          </div>
        </div>

        {/* List of Templates */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold">Saved Templates</h4>
            {defaultTemplateId && (
              <button
                className="btn btn-ghost btn-xs"
                onClick={handleClearDefault}
                title="Clear default template"
              >
                Clear Default
              </button>
            )}
          </div>
          
          {Object.keys(templates).length === 0 ? (
            <div className="text-center py-8 text-base-content/60">
              <p>No templates saved yet</p>
              <p className="text-xs mt-2">Save your current configuration as a template to reuse it later</p>
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(templates).map(([id, template]) => {
                const isDefault = id === defaultTemplateId;
                return (
                  <div key={id} className={`border rounded-lg p-3 ${isDefault ? 'border-primary bg-primary/5' : 'border-base-300'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h5 className="font-semibold">{template.name}</h5>
                          {isDefault && (
                            <TbStarFilled className="w-4 h-4 text-primary" title="Default template" />
                          )}
                        </div>
                        {template.description && (
                          <p className="text-sm text-base-content/70 mt-1">{template.description}</p>
                        )}
                        <p className="text-xs text-base-content/50 mt-1">
                          Created: {new Date(template.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        {!isDefault && (
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => handleSetDefault(id)}
                            title="Set as default template"
                          >
                            <TbStar className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => handleLoadTemplate(id)}
                          disabled={isLoading}
                          title="Load this template"
                        >
                          <TbFileDownload className="w-4 h-4" />
                          Load
                        </button>
                        <button
                          className="btn btn-ghost btn-xs text-error"
                          onClick={() => handleDeleteTemplate(id)}
                          disabled={isLoading}
                          title="Delete this template"
                        >
                          <TbTrash className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Info about default template */}
        <div className="alert alert-info mt-4">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <div className="text-sm">
            <div className="font-bold">Template Storage</div>
            <div>Templates are saved in browser localStorage and persist across sessions. Each tab maintains its own active configuration in sessionStorage.</div>
            {defaultTemplateId && <div className="mt-1">The default template will be automatically loaded when opening a new tab.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}