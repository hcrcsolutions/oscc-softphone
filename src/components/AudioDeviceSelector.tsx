'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { TbMicrophone, TbVolume, TbRefresh } from 'react-icons/tb';
import AudioLevelMeter from '@/components/AudioLevelMeter';
import { useTabStorage } from '@/utils/tabStorage';

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

interface AudioSettings {
  microphoneDevice?: string;
  speakerDevice?: string;
  ringVolume?: number;
  microphoneVolume?: number;
}

interface AudioDeviceSelectorProps {
  onMicrophoneChange?: (deviceId: string) => void;
  onSpeakerChange?: (deviceId: string) => void;
  sipService?: any;
  isMicrophoneMuted?: boolean;
  isInActiveCall?: boolean;
}

export default function AudioDeviceSelector({ 
  onMicrophoneChange, 
  onSpeakerChange,
  sipService,
  isMicrophoneMuted = false,
  isInActiveCall = false 
}: AudioDeviceSelectorProps) {
  const [microphones, setMicrophones] = useState<AudioDevice[]>([]);
  const [speakers, setSpeakers] = useState<AudioDevice[]>([]);
  const [selectedMicrophone, setSelectedMicrophone] = useState<string>('default');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('default');
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const { getObject, setObject } = useTabStorage();
  const [error, setError] = useState<string | null>(null);
  const [inputLevel, setInputLevel] = useState<number>(0);
  const [outputLevel, setOutputLevel] = useState<number>(0);
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);

  // Refs for audio monitoring
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Use refs for props that are checked in animation frame to avoid stale closures
  const isInActiveCallRef = useRef(isInActiveCall);
  const isMicrophoneMutedRef = useRef(isMicrophoneMuted);

  useEffect(() => {
    isInActiveCallRef.current = isInActiveCall;
  }, [isInActiveCall]);

  useEffect(() => {
    isMicrophoneMutedRef.current = isMicrophoneMuted;
  }, [isMicrophoneMuted]);

  // Load saved preferences from tab storage
  useEffect(() => {
    const savedAudioSettings = getObject<AudioSettings>('audioSettings');
    if (savedAudioSettings) {
      if (savedAudioSettings.microphoneDevice) {
        setSelectedMicrophone(savedAudioSettings.microphoneDevice);
      }
      if (savedAudioSettings.speakerDevice) {
        setSelectedSpeaker(savedAudioSettings.speakerDevice);
      }
    }
  }, [getObject]);

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
          label: device.label ? device.label.replace(/\s*\([^)]*\)\s*$/, '') : `Microphone ${index + 1}`,
          kind: 'audioinput' as const
        }));

      // Filter and format audio output devices (speakers)
      const audioOutputs: AudioDevice[] = devices
        .filter(device => device.kind === 'audiooutput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label ? device.label.replace(/\s*\([^)]*\)\s*$/, '') : `Speaker ${index + 1}`,
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
      
      
    } catch (error) {
      console.error('Failed to enumerate devices:', error);
      setError('Failed to load audio devices. Please check your browser settings.');
    } finally {
      setIsLoading(false);
    }
  };

  // Start audio monitoring
  const startAudioMonitoring = async () => {
    try {
      // Stop any existing monitoring first
      if (audioContextRef.current) {
        try {
          await audioContextRef.current.close();
        } catch (e) {
          console.log('Could not close existing audio context:', e);
        }
        audioContextRef.current = null;
      }
      
      // Create audio context with proper error handling
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        console.error('Web Audio API is not supported in this browser');
        return;
      }
      
      audioContextRef.current = new AudioContextClass();
      
      if (!audioContextRef.current) {
        console.error('Failed to create AudioContext');
        return;
      }
      
      // Use the same constraints as the SIP service for consistency
      let constraints: MediaStreamConstraints;
      
      if (selectedMicrophone === 'default' || !selectedMicrophone) {
        // Match SIP service default constraints with echo cancellation
        constraints = { 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        };
      } else {
        // Use ideal device ID with audio processing
        constraints = {
          audio: {
            deviceId: { ideal: selectedMicrophone },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        };
      }
      
      try {
        micStreamRef.current = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (constraintError) {
        // If the selected device fails, try with the default device
        constraints = { 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        };
        micStreamRef.current = await navigator.mediaDevices.getUserMedia(constraints);
      }
      
      // Create analyser for input with more sensitive settings
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 1024; // Increased for better resolution
      analyserRef.current.smoothingTimeConstant = 0.3; // Less smoothing for more responsive levels
      analyserRef.current.minDecibels = -90;
      analyserRef.current.maxDecibels = -10;
      
      micSourceRef.current = audioContextRef.current.createMediaStreamSource(micStreamRef.current);
      micSourceRef.current.connect(analyserRef.current);

      // Create analyser for output monitoring
      outputAnalyserRef.current = audioContextRef.current.createAnalyser();
      outputAnalyserRef.current.fftSize = 1024;
      outputAnalyserRef.current.smoothingTimeConstant = 0.3;
      outputAnalyserRef.current.minDecibels = -90;
      outputAnalyserRef.current.maxDecibels = -10;

      setIsMonitoring(true);
      
    } catch (error) {
      console.error('Failed to start audio monitoring:', error);
      setIsMonitoring(false);
    }
  };
  
  // Stop audio monitoring
  const stopAudioMonitoring = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    analyserRef.current = null;
    outputAnalyserRef.current = null;
    
    setInputLevel(0);
    setOutputLevel(0);
    setIsMonitoring(false);
  };
  
  // Update audio levels
  const updateAudioLevels = useCallback(() => {
    // Update input level from microphone (show 0 if muted or not in active call)
    if (analyserRef.current && !isMicrophoneMutedRef.current && isInActiveCallRef.current) {
      const inputArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(inputArray);

      // Calculate average frequency data for better microphone level detection
      let inputSum = 0;
      let maxLevel = 0;

      // Focus on the frequency range most relevant for voice (300Hz - 3400Hz)
      // With 1024 FFT size and typical sample rate 48kHz, each bin is ~23Hz
      // So bins 13-148 cover roughly 300Hz-3400Hz
      const startBin = Math.floor(inputArray.length * 0.025); // ~300Hz
      const endBin = Math.floor(inputArray.length * 0.15);    // ~3400Hz

      for (let i = startBin; i < endBin && i < inputArray.length; i++) {
        const level = inputArray[i] / 255;
        inputSum += level;
        maxLevel = Math.max(maxLevel, level);
      }

      const avgLevel = inputSum / (endBin - startBin);
      // Use combination of average and peak for responsive but stable indication
      const combinedLevel = (avgLevel * 0.7) + (maxLevel * 0.3);

      // More aggressive amplification for microphone levels
      const finalLevel = Math.min(combinedLevel * 400, 100);

      setInputLevel(finalLevel);
    } else {
      setInputLevel(0);
    }

    // Update output level from remote media streams (only during active calls)
    if (outputAnalyserRef.current && isInActiveCallRef.current) {
      const outputArray = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
      outputAnalyserRef.current.getByteFrequencyData(outputArray);

      // Calculate output level using frequency domain data (like input)
      let outputSum = 0;
      let maxLevel = 0;

      // Focus on voice frequency range for output as well
      const startBin = Math.floor(outputArray.length * 0.025); // ~300Hz
      const endBin = Math.floor(outputArray.length * 0.15);    // ~3400Hz

      for (let i = startBin; i < endBin && i < outputArray.length; i++) {
        const level = outputArray[i] / 255;
        outputSum += level;
        maxLevel = Math.max(maxLevel, level);
      }

      const avgLevel = outputSum / (endBin - startBin);
      const combinedLevel = (avgLevel * 0.7) + (maxLevel * 0.3);
      const finalLevel = Math.min(combinedLevel * 400, 100);

      setOutputLevel(finalLevel);
    } else {
      setOutputLevel(0);
    }

    if (isMonitoring) {
      animationFrameRef.current = requestAnimationFrame(updateAudioLevels);
    }
  }, [isMonitoring]);
  
  // Connect to remote media streams for output monitoring
  const connectToRemoteMediaStreams = useCallback(() => {
    if (!sipService || !outputAnalyserRef.current || !audioContextRef.current) {
      return;
    }

    try {
      // Look for ALL audio elements, including those created by SIP.js
      const audioElements = document.querySelectorAll('audio');

      for (let i = 0; i < audioElements.length; i++) {
        const audio = audioElements[i] as HTMLAudioElement;

        // Check if this audio element has a media stream
        if (audio.srcObject && audio.srcObject instanceof MediaStream) {
          const stream = audio.srcObject as MediaStream;
          const audioTracks = stream.getAudioTracks();

          if (audioTracks.length === 0) continue;

          // Check if the stream has changed (different ID) - if so, clear the monitored flag
          const currentStreamId = stream.id;
          if (audio.dataset.monitoredStreamId && audio.dataset.monitoredStreamId !== currentStreamId) {
            delete audio.dataset.monitored;
            delete audio.dataset.monitoredStreamId;
          }

          // Skip if already successfully monitored for this stream
          if (audio.dataset.monitored === 'true' && audio.dataset.monitoredStreamId === currentStreamId) {
            continue;
          }

          try {
            // Create a media stream source from the remote audio stream
            const streamSource = audioContextRef.current!.createMediaStreamSource(stream);

            // Create a gain node for monitoring
            const monitorGain = audioContextRef.current!.createGain();
            monitorGain.gain.value = 1.0;

            // Connect: Stream -> Monitor Gain -> Analyser
            streamSource.connect(monitorGain);
            monitorGain.connect(outputAnalyserRef.current!);

            // Mark as monitored ONLY after successful connection
            audio.dataset.monitored = 'true';
            audio.dataset.monitoredStreamId = currentStreamId;

            // Only monitor the first stream we successfully connect to
            return;

          } catch (error) {
            console.error('Error connecting audio element:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error in connectToRemoteMediaStreams:', error);
    }
  }, [sipService]);

  // Start the animation loop when monitoring becomes active
  useEffect(() => {
    if (isMonitoring) {
      // Cancel any existing animation frame first
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      updateAudioLevels();
    } else {
      // Cancel animation frame when monitoring stops
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  }, [isMonitoring]);

  // Restart monitoring when entering/exiting active call
  useEffect(() => {
    if (isInActiveCall && isMonitoring) {
      // Check if microphone analyser connection exists, create if not
      if (!micSourceRef.current && audioContextRef.current && micStreamRef.current && analyserRef.current) {
        try {
          // Create new source and connect to analyser
          micSourceRef.current = audioContextRef.current.createMediaStreamSource(micStreamRef.current);
          micSourceRef.current.connect(analyserRef.current);
        } catch (error) {
          console.error('Failed to reconnect microphone analyser:', error);
        }
      }

      // Resume AudioContext if suspended
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }

      // Restart the animation loop with fresh closure
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      updateAudioLevels();
    }
  }, [isInActiveCall, updateAudioLevels]);

  // Start monitoring when component mounts and has permission
  useEffect(() => {
    if (hasPermission && selectedMicrophone) {
      startAudioMonitoring();

      // Try to connect immediately
      connectToRemoteMediaStreams();
      
      // Monitor for remote media streams every 250ms for faster detection
      const mediaMonitorInterval = setInterval(() => {
        connectToRemoteMediaStreams();
      }, 250);
      
      return () => {
        stopAudioMonitoring();
        clearInterval(mediaMonitorInterval);
        
        // Clear monitored flags when unmounting
        const audioElements = document.querySelectorAll('audio');
        audioElements.forEach(audio => {
          delete (audio as HTMLAudioElement).dataset.monitored;
        });
      };
    }
    
    return () => {
      stopAudioMonitoring();
    };
  }, [hasPermission, selectedMicrophone, connectToRemoteMediaStreams]);
  
  // Initialize device enumeration
  useEffect(() => {
    enumerateDevices();

    // Listen for device changes (when devices are plugged/unplugged)
    const handleDeviceChange = () => {
      enumerateDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      stopAudioMonitoring();
    };
  }, [hasPermission]);

  // Handle microphone selection
  const handleMicrophoneChange = async (deviceId: string) => {
    setSelectedMicrophone(deviceId);
    
    // Save to tab storage
    const settings: AudioSettings = getObject<AudioSettings>('audioSettings') || {};
    settings.microphoneDevice = deviceId;
    setObject('audioSettings', settings);
    
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
    setSelectedSpeaker(deviceId);
    
    // Save to tab storage
    const settings: AudioSettings = getObject<AudioSettings>('audioSettings') || {};
    settings.speakerDevice = deviceId;
    setObject('audioSettings', settings);
    
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
            <TbRefresh className="w-4 h-4" />
            Refresh
          </button>
        </div>
        
        <div className="grid gap-3">
          {/* Microphone Selector */}
          <div className="form-control">
            <div className="flex items-center gap-2 mb-1">
              <TbMicrophone className="w-4 h-4 text-primary" />
              <label className="label-text text-sm font-medium">Microphone</label>
            </div>
            <div className="flex items-center gap-3">
              <select
                className="select select-bordered select-sm flex-1 pl-3"
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
              
              {/* Audio Input Level Meter */}
              <AudioLevelMeter 
                level={inputLevel}
                label="IN"
                isInActiveCall={isInActiveCall}
                isMuted={isMicrophoneMuted}
                type="input"
              />
            </div>
          </div>

          {/* Speaker Selector */}
          <div className="form-control">
            <div className="flex items-center gap-2 mb-1">
              <TbVolume className="w-4 h-4 text-primary" />
              <label className="label-text text-sm font-medium">Speaker</label>
            </div>
            <div className="flex items-center gap-3">
              <select
                className="select select-bordered select-sm flex-1 pl-3"
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
              
              {/* Audio Output Level Meter */}
              <AudioLevelMeter 
                level={outputLevel}
                label="OUT"
                isInActiveCall={isInActiveCall}
                type="output"
              />
            </div>
          </div>
        </div>

        {/* Device count info and monitoring status */}
        <div className="flex justify-between items-center text-xs text-base-content/60 mt-2">
          <div>
            Found {microphones.length} microphone(s) and {speakers.length} speaker(s)
          </div>
          {isMonitoring && (
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
              <span>Audio monitoring active</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}