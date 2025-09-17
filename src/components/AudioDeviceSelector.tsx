'use client';

import { useState, useEffect } from 'react';
import { TbMicrophone, TbVolume } from 'react-icons/tb';

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

interface AudioDeviceSelectorProps {
  onMicrophoneChange?: (deviceId: string) => void;
  onSpeakerChange?: (deviceId: string) => void;
  sipService?: any;
}

export default function AudioDeviceSelector({ 
  onMicrophoneChange, 
  onSpeakerChange,
  sipService 
}: AudioDeviceSelectorProps) {
  const [microphones, setMicrophones] = useState<AudioDevice[]>([]);
  const [speakers, setSpeakers] = useState<AudioDevice[]>([]);
  const [selectedMicrophone, setSelectedMicrophone] = useState<string>('default');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('default');
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load saved preferences from localStorage
  useEffect(() => {
    const savedAudioSettings = localStorage.getItem('audioSettings');
    if (savedAudioSettings) {
      try {
        const settings = JSON.parse(savedAudioSettings);
        if (settings.microphoneDevice) {
          setSelectedMicrophone(settings.microphoneDevice);
        }
        if (settings.speakerDevice) {
          setSelectedSpeaker(settings.speakerDevice);
        }
      } catch (error) {
        console.error('Failed to load audio settings:', error);
      }
    }
  }, []);

  // Enumerate audio devices
  const enumerateDevices = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Request microphone permission first to get device labels
      if (!hasPermission) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop());
          setHasPermission(true);
        } catch (permError) {
          console.error('Microphone permission denied:', permError);
          setError('Microphone access denied. Please grant permission to select audio devices.');
          setIsLoading(false);
          return;
        }
      }

      // Get all media devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      // Filter and format audio input devices (microphones)
      const audioInputs: AudioDevice[] = devices
        .filter(device => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
          kind: 'audioinput' as const
        }));

      // Filter and format audio output devices (speakers)
      const audioOutputs: AudioDevice[] = devices
        .filter(device => device.kind === 'audiooutput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Speaker ${index + 1}`,
          kind: 'audiooutput' as const
        }));

      // Add default options if not present
      if (audioInputs.length > 0 && !audioInputs.find(d => d.deviceId === 'default')) {
        audioInputs.unshift({
          deviceId: 'default',
          label: 'System Default Microphone',
          kind: 'audioinput'
        });
      }

      if (audioOutputs.length > 0 && !audioOutputs.find(d => d.deviceId === 'default')) {
        audioOutputs.unshift({
          deviceId: 'default',
          label: 'System Default Speaker',
          kind: 'audiooutput'
        });
      }

      setMicrophones(audioInputs);
      setSpeakers(audioOutputs);
      
      console.log('🎤 Found microphones:', audioInputs.length);
      console.log('🔊 Found speakers:', audioOutputs.length);
      
    } catch (error) {
      console.error('Failed to enumerate devices:', error);
      setError('Failed to load audio devices. Please check your browser settings.');
    } finally {
      setIsLoading(false);
    }
  };

  // Initialize device enumeration
  useEffect(() => {
    enumerateDevices();

    // Listen for device changes (when devices are plugged/unplugged)
    const handleDeviceChange = () => {
      console.log('Audio devices changed, re-enumerating...');
      enumerateDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [hasPermission]);

  // Handle microphone selection
  const handleMicrophoneChange = async (deviceId: string) => {
    console.log('🎤 Microphone selected:', deviceId);
    setSelectedMicrophone(deviceId);
    
    // Save to localStorage
    const savedSettings = localStorage.getItem('audioSettings');
    const settings = savedSettings ? JSON.parse(savedSettings) : {};
    settings.microphoneDevice = deviceId;
    localStorage.setItem('audioSettings', JSON.stringify(settings));
    
    // Notify parent component
    if (onMicrophoneChange) {
      onMicrophoneChange(deviceId);
    }
    
    // Update SIP service if available
    if (sipService && sipService.updateAudioDevice) {
      try {
        await sipService.updateAudioDevice('microphone', deviceId);
      } catch (error) {
        console.error('Failed to update microphone in SIP service:', error);
      }
    }
  };

  // Handle speaker selection
  const handleSpeakerChange = async (deviceId: string) => {
    console.log('🔊 Speaker selected:', deviceId);
    setSelectedSpeaker(deviceId);
    
    // Save to localStorage
    const savedSettings = localStorage.getItem('audioSettings');
    const settings = savedSettings ? JSON.parse(savedSettings) : {};
    settings.speakerDevice = deviceId;
    localStorage.setItem('audioSettings', JSON.stringify(settings));
    
    // Notify parent component
    if (onSpeakerChange) {
      onSpeakerChange(deviceId);
    }
    
    // Update SIP service if available
    if (sipService && sipService.updateAudioDevice) {
      try {
        await sipService.updateAudioDevice('speaker', deviceId);
      } catch (error) {
        console.error('Failed to update speaker in SIP service:', error);
      }
    }
  };

  // Refresh devices button
  const handleRefreshDevices = () => {
    console.log('🔄 Refreshing audio devices...');
    enumerateDevices();
  };

  if (isLoading) {
    return (
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <div className="flex items-center justify-center">
            <span className="loading loading-spinner loading-md"></span>
            <span className="ml-2">Loading audio devices...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error && !hasPermission) {
    return (
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <div className="alert alert-warning">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-.833-1.96-.833-2.73 0L3.34 16c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div>
              <div className="font-bold">Microphone Permission Required</div>
              <div className="text-sm">{error}</div>
              <button 
                className="btn btn-sm btn-primary mt-2"
                onClick={enumerateDevices}
              >
                Grant Permission
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="card-title text-lg">Audio Devices</h3>
          <button
            onClick={handleRefreshDevices}
            className="btn btn-ghost btn-xs"
            title="Refresh devices"
          >
            🔄 Refresh
          </button>
        </div>
        
        <div className="grid gap-3">
          {/* Microphone Selector */}
          <div className="form-control">
            <div className="flex items-center gap-2 mb-1">
              <TbMicrophone className="w-4 h-4 text-primary" />
              <label className="label-text text-sm font-medium">Microphone</label>
            </div>
            <select
              className="select select-bordered select-sm w-full"
              value={selectedMicrophone}
              onChange={(e) => handleMicrophoneChange(e.target.value)}
              disabled={microphones.length === 0}
            >
              {microphones.length === 0 ? (
                <option value="">No microphones found</option>
              ) : (
                microphones.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Speaker Selector */}
          <div className="form-control">
            <div className="flex items-center gap-2 mb-1">
              <TbVolume className="w-4 h-4 text-primary" />
              <label className="label-text text-sm font-medium">Speaker</label>
            </div>
            <select
              className="select select-bordered select-sm w-full"
              value={selectedSpeaker}
              onChange={(e) => handleSpeakerChange(e.target.value)}
              disabled={speakers.length === 0}
            >
              {speakers.length === 0 ? (
                <option value="">No speakers found</option>
              ) : (
                speakers.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Device count info */}
        <div className="text-xs text-base-content/60 mt-2">
          Found {microphones.length} microphone(s) and {speakers.length} speaker(s)
        </div>
      </div>
    </div>
  );
}