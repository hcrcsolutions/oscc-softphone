'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
  isMicrophoneMuted?: boolean;
}

export default function AudioDeviceSelector({ 
  onMicrophoneChange, 
  onSpeakerChange,
  sipService,
  isMicrophoneMuted = false 
}: AudioDeviceSelectorProps) {
  const [microphones, setMicrophones] = useState<AudioDevice[]>([]);
  const [speakers, setSpeakers] = useState<AudioDevice[]>([]);
  const [selectedMicrophone, setSelectedMicrophone] = useState<string>('default');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('default');
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
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
      
      // Get microphone stream with fallback
      let constraints: MediaStreamConstraints;
      
      if (selectedMicrophone === 'default' || !selectedMicrophone) {
        // Use default device
        constraints = { audio: true };
      } else {
        // Use ideal instead of exact for better compatibility
        constraints = {
          audio: {
            deviceId: { ideal: selectedMicrophone }
          }
        };
      }
      
      try {
        micStreamRef.current = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('🎤 Got microphone stream for device:', selectedMicrophone);
      } catch (constraintError) {
        // If the selected device fails, try with the default device
        console.warn('Failed to get microphone with deviceId, trying default:', constraintError);
        constraints = { audio: true };
        micStreamRef.current = await navigator.mediaDevices.getUserMedia(constraints);
      }
      
      // Create analyser for input
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.8;
      
      const source = audioContextRef.current.createMediaStreamSource(micStreamRef.current);
      source.connect(analyserRef.current);
      
      // Create analyser for output monitoring
      outputAnalyserRef.current = audioContextRef.current.createAnalyser();
      outputAnalyserRef.current.fftSize = 256;
      outputAnalyserRef.current.smoothingTimeConstant = 0.8;
      
      setIsMonitoring(true);
      console.log('🎤 Audio monitoring started with AudioContext:', audioContextRef.current.state);
      
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
    console.log('🎤 Audio monitoring stopped');
  };
  
  // Update audio levels
  const updateAudioLevels = () => {
    // Update input level from microphone (show 0 if muted)
    if (analyserRef.current && !isMicrophoneMuted) {
      const inputArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteTimeDomainData(inputArray);
      
      // Calculate RMS (Root Mean Square) for input using time domain data
      let inputSum = 0;
      for (let i = 0; i < inputArray.length; i++) {
        const sample = (inputArray[i] - 128) / 128; // Convert to -1 to 1 range
        inputSum += sample * sample;
      }
      const inputRMS = Math.sqrt(inputSum / inputArray.length);
      // Amplify the signal for better visual feedback
      setInputLevel(Math.min(inputRMS * 200, 100));
    } else {
      setInputLevel(0);
    }
    
    // Update output level from remote media streams
    if (outputAnalyserRef.current) {
      const outputArray = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
      outputAnalyserRef.current.getByteTimeDomainData(outputArray);
      
      // Calculate RMS for output from FreeSWITCH media using time domain data
      let outputSum = 0;
      let hasSignal = false;
      for (let i = 0; i < outputArray.length; i++) {
        const sample = (outputArray[i] - 128) / 128; // Convert to -1 to 1 range
        outputSum += sample * sample;
        // Check if there's actual audio signal (not silence)
        if (Math.abs(sample) > 0.01) {
          hasSignal = true;
        }
      }
      
      if (hasSignal) {
        const outputRMS = Math.sqrt(outputSum / outputArray.length);
        // Amplify the signal for better visual feedback
        setOutputLevel(Math.min(outputRMS * 200, 100));
      } else {
        setOutputLevel(0);
      }
    } else {
      setOutputLevel(0);
    }
    
    if (isMonitoring) {
      animationFrameRef.current = requestAnimationFrame(updateAudioLevels);
    }
  };
  
  // Connect to remote media streams for output monitoring
  const connectToRemoteMediaStreams = useCallback(() => {
    if (!sipService || !outputAnalyserRef.current || !audioContextRef.current) {
      if (!audioContextRef.current) {
        console.log('AudioContext not initialized yet, skipping remote stream connection');
      }
      return;
    }

    try {
      // Look for audio elements with active media streams
      const audioElements = document.querySelectorAll('audio');
      
      for (const audioElement of audioElements) {
        const audio = audioElement as HTMLAudioElement;
        
        // Skip if already monitored
        if (audio.dataset.monitored === 'true') continue;
        
        // Check if this audio element has a media stream
        if (!audio.srcObject) continue;
        
        const stream = audio.srcObject as MediaStream;
        const audioTracks = stream.getAudioTracks();
        
        // Skip if no audio tracks
        if (audioTracks.length === 0) continue;
        
        console.log(`🔊 Found audio element with ${audioTracks.length} audio track(s), attempting to monitor`);
        
        try {
          // Create a media stream source from the remote audio stream
          const streamSource = audioContextRef.current!.createMediaStreamSource(stream);
          
          // Create a gain node for monitoring without affecting playback
          const monitorGain = audioContextRef.current!.createGain();
          monitorGain.gain.value = 1.0; // Keep full volume for monitoring
          
          // Connect: Stream -> Monitor Gain -> Analyser
          streamSource.connect(monitorGain);
          monitorGain.connect(outputAnalyserRef.current!);
          
          // Don't connect to destination - let the original audio element handle playback
          // This avoids double audio playback
          
          // Mark as monitored to avoid reconnecting
          audio.dataset.monitored = 'true';
          
          console.log('🔊 Successfully connected to remote WebRTC audio stream for level monitoring');
          console.log(`   Audio tracks: ${audioTracks.map(t => `${t.label} (${t.enabled ? 'enabled' : 'disabled'})`).join(', ')}`);
          console.log(`   Stream ID: ${stream.id}`);
          console.log(`   Audio element playing: ${!audio.paused}`);
          
          // Only monitor the first active stream
          return;
          
        } catch (error) {
          // This error might occur if the stream was already connected to another source
          // Try an alternative approach using a clone of the stream
          try {
            console.log('🔊 First attempt failed, trying with cloned stream');
            const clonedStream = stream.clone();
            const clonedSource = audioContextRef.current!.createMediaStreamSource(clonedStream);
            clonedSource.connect(outputAnalyserRef.current!);
            audio.dataset.monitored = 'true';
            console.log('🔊 Successfully connected cloned stream for monitoring');
            return;
          } catch (cloneError) {
            console.log('Could not connect to media stream:', cloneError);
          }
        }
      }
    } catch (error) {
      console.log('Error in connectToRemoteMediaStreams:', error);
    }
  }, [sipService]);

  // Start monitoring when component mounts and has permission
  useEffect(() => {
    if (hasPermission && selectedMicrophone) {
      startAudioMonitoring();
      updateAudioLevels();
      
      // Try to connect immediately
      connectToRemoteMediaStreams();
      
      // Monitor for remote media streams every 500ms for faster detection
      const mediaMonitorInterval = setInterval(() => {
        connectToRemoteMediaStreams();
      }, 500);
      
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
      console.log('Audio devices changed, re-enumerating...');
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
            <div className="flex items-center gap-3">
              <select
                className="select select-bordered select-sm flex-1"
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
              <div className="flex items-center gap-1">
                <div className="text-xs text-base-content/60">IN</div>
                <div className={`w-16 h-12 rounded-sm overflow-hidden flex items-end ${
                  isMicrophoneMuted ? 'bg-pink-200' : 'bg-base-300'
                }`}>
                  {/* Segmented level meter */}
                  <div className="w-full h-full flex flex-col-reverse gap-px">
                    {[...Array(16)].map((_, i) => (
                      <div 
                        key={i}
                        className={`w-full flex-1 transition-all duration-100 ${
                          !isMicrophoneMuted && inputLevel > i * 6.25 
                            ? 'bg-gray-400' 
                            : 'bg-transparent'
                        }`}
                      ></div>
                    ))}
                  </div>
                </div>
                <div className="text-xs font-mono w-8 text-right">
                  {isMicrophoneMuted ? 'MUTED' : `${Math.round(inputLevel)}%`}
                </div>
              </div>
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
                className="select select-bordered select-sm flex-1"
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
              <div className="flex items-center gap-1">
                <div className="text-xs text-base-content/60">OUT</div>
                <div className="w-16 h-12 bg-base-300 rounded-sm overflow-hidden flex items-end">
                  {/* Segmented level meter */}
                  <div className="w-full h-full flex flex-col-reverse gap-px">
                    {[...Array(16)].map((_, i) => (
                      <div 
                        key={i}
                        className={`w-full flex-1 transition-all duration-100 ${
                          outputLevel > i * 6.25 
                            ? 'bg-gray-400' 
                            : 'bg-transparent'
                        }`}
                      ></div>
                    ))}
                  </div>
                </div>
                <div className="text-xs font-mono w-8 text-right">
                  {Math.round(outputLevel)}%
                </div>
              </div>
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