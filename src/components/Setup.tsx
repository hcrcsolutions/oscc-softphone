'use client';

import { useState, useEffect } from 'react';
import { SipConfig } from '@/services/sipService';

export default function Setup() {
  const [sipConfig, setSipConfig] = useState<SipConfig>({
    server: '10.254.18.165',
    username: '1002',
    password: '',
    domain: '10.254.18.165',
    protocol: 'ws'
  });
  const [audioSettings, setAudioSettings] = useState({
    microphoneDevice: 'default',
    speakerDevice: 'default',
    ringVolume: 50,
    microphoneVolume: 50
  });
  const [isTestingAudio, setIsTestingAudio] = useState(false);

  useEffect(() => {
    // Load saved configurations
    const savedSipConfig = localStorage.getItem('sipConfig');
    const savedAudioSettings = localStorage.getItem('audioSettings');
    
    if (savedSipConfig) {
      try {
        setSipConfig(JSON.parse(savedSipConfig));
      } catch (error) {
        console.error('Failed to load SIP configuration:', error);
      }
    } else {
      // Save default FreeSWITCH configuration if none exists
      const defaultConfig = {
        server: '10.254.18.165',
        username: '1002',
        password: '',
        domain: '10.254.18.165',
        protocol: 'ws' as const
      };
      localStorage.setItem('sipConfig', JSON.stringify(defaultConfig));
    }
    
    if (savedAudioSettings) {
      try {
        setAudioSettings(JSON.parse(savedAudioSettings));
      } catch (error) {
        console.error('Failed to load audio settings:', error);
      }
    }
  }, []);

  const handleSipConfigChange = (field: keyof SipConfig, value: string) => {
    setSipConfig(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleAudioSettingChange = (field: string, value: string | number) => {
    setAudioSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const saveSipConfiguration = () => {
    try {
      localStorage.setItem('sipConfig', JSON.stringify(sipConfig));
      // You could also trigger a re-registration here
      alert('SIP configuration saved! Please reload the Phone component to apply changes.');
    } catch (error) {
      console.error('Failed to save SIP configuration:', error);
      alert('Failed to save configuration');
    }
  };

  const saveAudioSettings = () => {
    try {
      localStorage.setItem('audioSettings', JSON.stringify(audioSettings));
      alert('Audio settings saved!');
    } catch (error) {
      console.error('Failed to save audio settings:', error);
      alert('Failed to save audio settings');
    }
  };

  const testAudio = async () => {
    setIsTestingAudio(true);
    try {
      // Test microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Play a test tone (simple beep)
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      gainNode.gain.value = audioSettings.ringVolume / 100 * 0.1; // Convert to appropriate volume
      
      oscillator.start();
      
      setTimeout(() => {
        oscillator.stop();
        audioContext.close();
        stream.getTracks().forEach(track => track.stop());
        setIsTestingAudio(false);
        alert('Audio test completed!');
      }, 500);
      
    } catch (error) {
      console.error('Audio test failed:', error);
      setIsTestingAudio(false);
      alert('Audio test failed. Please check your microphone permissions.');
    }
  };

  return (
    <div className="p-8">
      <h2 className="text-3xl font-bold mb-6">Setup</h2>
      
      <div className="grid gap-6">
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h3 className="card-title mb-4">SIP Configuration</h3>
            <div className="text-sm text-base-content/60 mb-4">
              Configure your SIP server settings to enable calling functionality
            </div>
            
            <div className="form-control w-full">
              <div className="text-xs text-base-content/60 mb-1">FreeSWITCH IP address</div>
              <div className="flex items-center gap-4">
                <label className="label-text w-48">SIP Server (WebSocket)</label>
                <input 
                  type="text" 
                  placeholder="sip.example.com" 
                  className="input input-bordered flex-1"
                  value={sipConfig.server}
                  onChange={(e) => handleSipConfigChange('server', e.target.value)}
                />
              </div>
            </div>
            
            <div className="form-control w-full">
              <div className="text-xs text-base-content/60 mb-1">Your SIP account username</div>
              <div className="flex items-center gap-4">
                <label className="label-text w-48">Username</label>
                <input 
                  type="text" 
                  placeholder="1001" 
                  className="input input-bordered flex-1"
                  value={sipConfig.username}
                  onChange={(e) => handleSipConfigChange('username', e.target.value)}
                />
              </div>
            </div>
            
            <div className="form-control w-full">
              <div className="text-xs text-base-content/60 mb-1">Your SIP account password</div>
              <div className="flex items-center gap-4">
                <label className="label-text w-48">Password</label>
                <input 
                  type="password" 
                  placeholder="Enter password" 
                  className="input input-bordered flex-1"
                  value={sipConfig.password}
                  onChange={(e) => handleSipConfigChange('password', e.target.value)}
                />
              </div>
            </div>
            
            <div className="form-control w-full">
              <div className="text-xs text-base-content/60 mb-1">SIP domain if different from server</div>
              <div className="flex items-center gap-4">
                <label className="label-text w-48">Domain (Optional)</label>
                <input 
                  type="text" 
                  placeholder="example.com" 
                  className="input input-bordered flex-1"
                  value={sipConfig.domain}
                  onChange={(e) => handleSipConfigChange('domain', e.target.value)}
                />
              </div>
            </div>
            
            <div className="form-control w-full">
              <div className="text-xs text-base-content/60 mb-1">Choose transport protocol</div>
              <div className="flex items-center gap-4">
                <label className="label-text w-48">WebSocket Protocol</label>
                  <div className="flex gap-4">
                    <label className="label cursor-pointer">
                      <input 
                        type="radio" 
                        name="protocol" 
                        className="radio radio-primary" 
                        value="ws"
                        checked={sipConfig.protocol === 'ws'}
                        onChange={(e) => handleSipConfigChange('protocol', e.target.value)}
                      />
                      <span className="label-text ml-2">WS (port 5066)</span>
                    </label>
                    <label className="label cursor-pointer">
                      <input 
                        type="radio" 
                        name="protocol" 
                        className="radio radio-primary" 
                        value="wss"
                        checked={sipConfig.protocol === 'wss'}
                        onChange={(e) => handleSipConfigChange('protocol', e.target.value)}
                      />
                      <span className="label-text ml-2">WSS (port 7443)</span>
                    </label>
                  </div>
              </div>
            </div>
            
            <div className="alert alert-info mt-4">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <div>
                <div className="font-bold">FreeSWITCH Configuration</div>
                <div className="text-sm">
                  Default settings configured for FreeSWITCH on 10.254.18.165. 
                  Select WS (port 5066) for unencrypted or WSS (port 7443) for encrypted WebSocket connections.
                </div>
              </div>
            </div>
            
            <div className="card-actions justify-end mt-4">
              <button 
                className="btn btn-primary"
                onClick={saveSipConfiguration}
                disabled={!sipConfig.server || !sipConfig.username || !sipConfig.password}
              >
                Save SIP Configuration
              </button>
            </div>
          </div>
        </div>
        
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h3 className="card-title mb-4">Audio Settings</h3>
            
            <div className="form-control w-full h-15">
              <label className="label h-9">
                <span className="label-text w-48">Microphone Device</span>
              </label>
              <select 
                className="select select-bordered w-full h-9"
                value={audioSettings.microphoneDevice}
                onChange={(e) => handleAudioSettingChange('microphoneDevice', e.target.value)}
              >
                <option value="default">Default Microphone</option>
                <option value="built-in">Built-in Microphone</option>
                <option value="external">External Microphone</option>
              </select>
            </div>
            
            <div className="form-control w-full h-15">
              <label className="label h-9">
                <span className="label-text w-48">Speaker Device</span>
              </label>
              <select 
                className="select select-bordered w-full h-9"
                value={audioSettings.speakerDevice}
                onChange={(e) => handleAudioSettingChange('speakerDevice', e.target.value)}
              >
                <option value="default">Default Speaker</option>
                <option value="built-in">Built-in Speaker</option>
                <option value="headphones">Headphones</option>
              </select>
            </div>
            
            <div className="form-control w-full h-15">
              <label className="label h-9">
                <span className="label-text w-48">Ring Volume: {audioSettings.ringVolume}%</span>
              </label>
              <input 
                type="range" 
                min="0" 
                max="100" 
                className="range range-primary h-9"
                value={audioSettings.ringVolume}
                onChange={(e) => handleAudioSettingChange('ringVolume', parseInt(e.target.value))}
              />
            </div>
            
            <div className="form-control w-full h-15">
              <label className="label h-9">
                <span className="label-text w-48">Microphone Volume: {audioSettings.microphoneVolume}%</span>
              </label>
              <input 
                type="range" 
                min="0" 
                max="100" 
                className="range range-primary h-9"
                value={audioSettings.microphoneVolume}
                onChange={(e) => handleAudioSettingChange('microphoneVolume', parseInt(e.target.value))}
              />
            </div>
            
            <div className="card-actions justify-end mt-4">
              <button 
                className={`btn btn-secondary ${isTestingAudio ? 'loading' : ''}`}
                onClick={testAudio}
                disabled={isTestingAudio}
              >
                {isTestingAudio ? 'Testing...' : 'Test Audio'}
              </button>
              <button 
                className="btn btn-primary"
                onClick={saveAudioSettings}
              >
                Save Audio Settings
              </button>
            </div>
          </div>
        </div>

        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h3 className="card-title mb-4">Setup Instructions</h3>
            <div className="space-y-4 text-sm">
              <div className="steps steps-vertical lg:steps-horizontal">
                <div className="step step-primary">Configure SIP Server</div>
                <div className="step step-primary">Test Audio Settings</div>
                <div className="step">Start Making Calls</div>
              </div>
              
              <div className="alert alert-warning">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.996-.833-2.767 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
                </svg>
                <div>
                  <div className="font-bold">Browser Permissions Required</div>
                  <div>This application requires microphone permissions to function properly. Please allow access when prompted.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}