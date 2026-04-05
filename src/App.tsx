import React, { useState, useEffect, useRef } from 'react';
import { 
  Smartphone, 
  Cpu, 
  Wifi, 
  ShieldAlert, 
  ShieldCheck,
  Terminal, 
  RotateCcw, 
  Download, 
  Radio, 
  CheckCircle2, 
  AlertCircle,
  Activity,
  Settings,
  Lock,
  Unlock,
  LogOut,
  LogIn,
  User as UserIcon,
  ListChecks,
  Circle,
  CheckCircle,
  Usb,
  Upload,
  FileUp,
  Sparkles,
  Brain,
  Zap,
  X,
  MessageSquare,
  Send,
  Bot
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, loginWithGoogle, logout, OperationType, handleFirestoreError } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, doc, setDoc, query, orderBy, onSnapshot, serverTimestamp, addDoc, Timestamp } from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// --- Types ---
type DeviceState = 'IDLE' | 'RESETTING' | 'INSTALLING' | 'PROVISIONING' | 'COMPLETED';
type ConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';
type DownloadStatus = 'IDLE' | 'DOWNLOADING' | 'PAUSED' | 'COMPLETED';

interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

interface HistoryEntry {
  id: string;
  timestamp: string;
  operation: string;
  details: string;
  status: 'SUCCESS' | 'FAILED';
}

interface OSVersion {
  id: string;
  name: string;
  version: string;
  description: string;
  checksum: string;
}

interface DeviceModel {
  id: string;
  name: string;
  sn: string;
  cpu: string;
  storage: string;
  ram: string;
  battery: string;
  isNetworkLocked: boolean;
}

// --- Constants ---
const DEVICE_MODELS: DeviceModel[] = [
  { id: 'p8p', name: 'Pixel 8 Pro', sn: 'PX-9920-X1', cpu: 'Tensor G3', storage: '256GB', ram: '12GB', battery: '84%', isNetworkLocked: true },
  { id: 's23', name: 'Samsung S23', sn: 'SM-G991-U2', cpu: 'Snapdragon 8 Gen 2', storage: '128GB', ram: '8GB', battery: '92%', isNetworkLocked: false },
  { id: 'p7a', name: 'Pixel 7a', sn: 'PX-7710-A4', cpu: 'Tensor G2', storage: '128GB', ram: '8GB', battery: '76%', isNetworkLocked: true },
  { id: 'x100', name: 'Sony Xperia 1 V', sn: 'SO-5520-V1', cpu: 'Snapdragon 8 Gen 2', storage: '512GB', ram: '12GB', battery: '88%', isNetworkLocked: false },
  { id: 'moto-pure', name: 'Motorola Moto G Pure', sn: 'MOT-G-7721', cpu: 'MediaTek Helio G25', storage: '32GB', ram: '3GB', battery: '95%', isNetworkLocked: false },
  { id: 'generic', name: 'Generic Android Device', sn: 'ADB-GEN-001', cpu: 'ARMv8-A', storage: '64GB', ram: '4GB', battery: '100%', isNetworkLocked: false },
];

const OS_OPTIONS: OSVersion[] = [
  { 
    id: 'native', 
    name: 'Native Android', 
    version: '14.0.0', 
    description: 'Stock manufacturer firmware',
    checksum: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  },
  { 
    id: 'graphene', 
    name: 'GrapheneOS', 
    version: '2024.03.28', 
    description: 'Privacy and security focused',
    checksum: 'sha256:5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03'
  },
  { 
    id: 'lineage', 
    name: 'LineageOS', 
    version: '21.0', 
    description: 'Community-driven open source',
    checksum: 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069'
  },
  { 
    id: 'calyx', 
    name: 'CalyxOS', 
    version: '5.4.1', 
    description: 'Privacy-focused with microG',
    checksum: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
  },
];

const PROVIDERS = ['T-Mobile', 'Verizon', 'AT&T', 'Google Fi', 'Starlink Mobile', 'Mint Mobile'];

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [deviceState, setDeviceState] = useState<DeviceState>('IDLE');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<DeviceModel>(DEVICE_MODELS[0]);
  const [selectedOS, setSelectedOS] = useState<OSVersion>(OS_OPTIONS[0]);
  const [selectedProvider, setSelectedProvider] = useState(PROVIDERS[0]);
  const [customDevices, setCustomDevices] = useState<DeviceModel[]>([]);
  const [showAddDeviceModal, setShowAddDeviceModal] = useState(false);
  const [newDeviceForm, setNewDeviceForm] = useState<Omit<DeviceModel, 'id'>>({
    name: '',
    sn: '',
    cpu: '',
    storage: '',
    ram: '',
    battery: '100%',
    isNetworkLocked: false
  });
  const [odinOptions, setOdinOptions] = useState({
    autoReboot: true,
    fResetTime: true,
    nandErase: false,
    rePartition: false
  });
  const [fileSlots, setFileSlots] = useState<{ [key: string]: string }>({
    BL: '',
    AP: '',
    CP: '',
    CSC: '',
    USERDATA: ''
  });
  const [isBootloaderLocked, setIsBootloaderLocked] = useState(true);
  const [isChecksumVerified, setIsChecksumVerified] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'model', text: string}[]>([
    { role: 'model', text: "Hello! I'm your Cellular Device & Provisioning Expert AI. I can help you with firmware flashing, network provisioning, hardware issues (like broken screens), or resetting a device without a PIN. What device are you working on today?" }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('CONNECTED');
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('IDLE');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [downloadedImages, setDownloadedImages] = useState<Set<string>>(new Set());
  const [customOSList, setCustomOSList] = useState<OSVersion[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const lastAutoStartedOS = useRef<string | null>(null);

  // --- Auth & Sync ---
  useEffect(() => {
    if (isChatOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isChatOpen]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      if (currentUser) {
        // Sync user profile
        setDoc(doc(db, 'users', currentUser.uid), {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          lastLogin: serverTimestamp()
        }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}`));
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !isAuthReady) {
      setHistory([]);
      return;
    }

    const historyRef = collection(db, 'users', user.uid, 'history');
    const q = query(historyRef, orderBy('timestamp', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const historyData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          timestamp: data.timestamp instanceof Timestamp 
            ? data.timestamp.toDate().toLocaleString() 
            : new Date().toLocaleString()
        } as HistoryEntry;
      });
      setHistory(historyData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/history`);
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  // --- Helpers ---
  const addLog = (message: string, type: 'info' | 'warn' | 'error' | 'success' = 'info') => {
    const newLog: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      message,
      type
    };
    setLogs(prev => [...prev, newLog]);
  };

  const addHistoryEntry = async (operation: string, details: string, status: 'SUCCESS' | 'FAILED') => {
    if (!user) return;
    
    const historyRef = collection(db, 'users', user.uid, 'history');
    try {
      await addDoc(historyRef, {
        userId: user.uid,
        timestamp: serverTimestamp(),
        operation,
        details,
        status
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/history`);
    }
  };

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // --- Auto-Download Trigger ---
  useEffect(() => {
    if (!downloadedImages.has(selectedOS.id) && downloadStatus === 'IDLE' && lastAutoStartedOS.current !== selectedOS.id) {
      lastAutoStartedOS.current = selectedOS.id;
      setDownloadStatus('DOWNLOADING');
      addLog(`Auto-starting download for ${selectedOS.name}...`, 'info');
    }
  }, [selectedOS.id, downloadedImages, downloadStatus, selectedOS.name]);

  // --- Download Simulation ---
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (downloadStatus === 'DOWNLOADING') {
      interval = setInterval(() => {
        setDownloadProgress(prev => {
          if (prev >= 100) {
            setDownloadStatus('COMPLETED');
            setDownloadedImages(current => new Set(current).add(selectedOS.id));
            addLog(`${selectedOS.name} image download complete.`, 'success');
            return 100;
          }
          // Simulate variable download speed
          const increment = Math.random() * 3 + 1;
          const next = Math.min(prev + increment, 100);
          
          // Estimate time remaining (roughly 2% per second average)
          const remainingPercent = 100 - next;
          setTimeRemaining(Math.ceil(remainingPercent / 2.5));
          
          return next;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [downloadStatus, selectedOS.id, selectedOS.name]);

  // --- Actions ---
  const toggleConnection = async () => {
    if (deviceState !== 'IDLE' || connectionStatus === 'CONNECTING') return;

    if (connectionStatus === 'CONNECTED') {
      setConnectionStatus('DISCONNECTED');
      addLog('Device disconnected from terminal.', 'warn');
    } else {
      setConnectionStatus('CONNECTING');
      addLog('Attempting to establish device connection...', 'info');
      await new Promise(r => setTimeout(r, 1500));
      
      // Respect user selection instead of random detection
      setConnectionStatus('CONNECTED');
      addLog(`Device connected: ${selectedDevice.name} (SN: ${selectedDevice.sn})`, 'success');
      
      if (selectedDevice.isNetworkLocked) {
        addLog('WARNING: Device network is LOCKED. Provisioning may fail.', 'warn');
      }
    }
  };

  const handleManualDeviceRegistration = () => {
    setShowAddDeviceModal(true);
    setNewDeviceForm({
      name: '',
      sn: `SN-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
      cpu: '',
      storage: '',
      ram: '',
      battery: '100%',
      isNetworkLocked: false
    });
  };

  const submitManualDeviceRegistration = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeviceForm.name) {
      addLog('Device registration failed: Name is required.', 'error');
      return;
    }

    const newDevice: DeviceModel = {
      id: `custom-dev-${Date.now()}`,
      ...newDeviceForm
    };

    setCustomDevices(prev => [...prev, newDevice]);
    setSelectedDevice(newDevice);
    setShowAddDeviceModal(false);
    addLog(`New device registered: ${newDevice.name}. You can now connect via USB.`, 'success');
  };

  const handleAutoDetect = async () => {
    if (deviceState !== 'IDLE' || connectionStatus === 'CONNECTING') return;
    
    setConnectionStatus('CONNECTING');
    addLog('Scanning USB ports for connected devices...', 'info');
    
    // Simulate a brief scanning delay
    await new Promise(r => setTimeout(r, 2000));

    // Logic: If user has already selected a device, prioritize "detecting" that one
    // to avoid frustrating overrides. Otherwise, pick a random one but favor the Motorola.
    let detected: DeviceModel;
    
    const findKnown = Math.random() > 0.1; // 90% chance to find a known device
    
    if (findKnown) {
      // If the user has already selected a specific device (not the first default one), 
      // there's a 70% chance we "detect" exactly that one.
      const isUserSelected = selectedDevice.id !== DEVICE_MODELS[0].id;
      
      if (isUserSelected && Math.random() > 0.3) {
        detected = selectedDevice;
      } else {
        // Otherwise, pick from the list, but let's favor the Motorola Moto G Pure 
        // since the user is currently working with it.
        const motoDevice = DEVICE_MODELS.find(d => d.id === 'moto-pure');
        if (motoDevice && Math.random() > 0.5) {
          detected = motoDevice;
        } else {
          detected = DEVICE_MODELS[Math.floor(Math.random() * DEVICE_MODELS.length)];
        }
      }

      setSelectedDevice(detected);
      setConnectionStatus('CONNECTED');
      addLog(`Auto-detected: ${detected.name} (SN: ${detected.sn}) on [COM3]`, 'success');
      
      if (detected.isNetworkLocked) {
        addLog('WARNING: Device network is LOCKED. Provisioning may fail.', 'warn');
      }
    } else {
      setConnectionStatus('DISCONNECTED');
      addLog('Unknown device detected on [COM3]. Manual registration required.', 'warn');
      handleManualDeviceRegistration();
    }
  };

  const simulateProcess = async (
    targetState: DeviceState, 
    steps: { msg: string; duration: number; type?: 'info' | 'warn' | 'success' }[]
  ) => {
    setDeviceState(targetState);
    setProgress(0);
    
    let currentProgress = 0;
    const totalSteps = steps.length;

    for (let i = 0; i < totalSteps; i++) {
      const step = steps[i];
      addLog(step.msg, step.type || 'info');
      
      // Simulate sub-progress
      const stepIncrement = 100 / totalSteps;
      const subSteps = 10;
      for (let j = 0; j < subSteps; j++) {
        await new Promise(r => setTimeout(r, step.duration / subSteps));
        currentProgress += stepIncrement / subSteps;
        setProgress(Math.min(currentProgress, 100));
      }
    }

    setDeviceState('IDLE');
    setProgress(0);
  };

  const handleNativeReset = async () => {
    if (deviceState !== 'IDLE') return;
    if (connectionStatus !== 'CONNECTED') {
      addLog('Error: Device must be connected to perform reset.', 'error');
      return;
    }
    try {
      await simulateProcess('RESETTING', [
        { msg: 'Initiating native state reset...', duration: 800 },
        { msg: 'Wiping user data partitions...', duration: 1500 },
        { msg: 'Restoring factory recovery image...', duration: 1200 },
        { msg: 'Verifying cryptographic signatures...', duration: 1000 },
        { msg: 'Device reset to native state successfully.', duration: 500, type: 'success' },
      ]);
      addHistoryEntry('Native Reset', 'Factory state restored', 'SUCCESS');
    } catch (e) {
      addHistoryEntry('Native Reset', 'Operation failed', 'FAILED');
    }
  };

  const handleOSInstall = async () => {
    if (deviceState !== 'IDLE') return;
    if (connectionStatus !== 'CONNECTED') {
      addLog('Error: Device must be connected to install OS.', 'error');
      return;
    }
    
    // In Odin mode, we check if at least AP is selected
    if (!fileSlots.AP && !downloadedImages.has(selectedOS.id)) {
      addLog('Error: AP file or OS image must be selected before installation.', 'error');
      return;
    }

    if (isBootloaderLocked) {
      addLog('Error: Bootloader must be unlocked before OS installation.', 'error');
      return;
    }
    // Automatically trigger verification if not done yet
    if (!isChecksumVerified && !fileSlots.AP) {
      addLog('OS image integrity not verified. Initiating verification first...', 'warn');
      await handleVerifyChecksum();
      if (!isChecksumVerified) {
        addLog('Error: OS image integrity verification failed.', 'error');
        return;
      }
    }
    try {
      await simulateProcess('INSTALLING', [
        { msg: `Analyzing firmware package...`, duration: 1000 },
        { msg: 'Checking binary version compatibility...', duration: 800 },
        { msg: 'Initializing flashing environment...', duration: 1200 },
        { msg: 'Flashing BL (Bootloader)...', duration: 1500 },
        { msg: 'Flashing AP (System/Kernel)...', duration: 4000 },
        { msg: 'Flashing CP (Modem)...', duration: 2000 },
        { msg: 'Flashing CSC (Region/Data)...', duration: 1500 },
        { msg: 'Verifying image checksums...', duration: 1000 },
        { msg: 'Firmware update successful. Rebooting...', duration: 500, type: 'success' },
      ]);
      addHistoryEntry('Firmware Flash', `${selectedOS.name} v${selectedOS.version}`, 'SUCCESS');
    } catch (e) {
      addHistoryEntry('Firmware Flash', `${selectedOS.name} v${selectedOS.version}`, 'FAILED');
    }
  };

  const handleFileSelect = (slot: string) => {
    const fileName = prompt(`Select file for ${slot}:`, `${selectedOS.id}_${slot.toLowerCase()}.tar.md5`);
    if (fileName) {
      setFileSlots(prev => ({ ...prev, [slot]: fileName }));
      addLog(`File loaded into ${slot}: ${fileName}`, 'info');
    }
  };

  const handleStartDownload = () => {
    if (downloadStatus === 'DOWNLOADING' || downloadedImages.has(selectedOS.id)) return;
    setDownloadStatus('DOWNLOADING');
    addLog(`Started downloading ${selectedOS.name} image...`, 'info');
  };

  const handlePauseDownload = () => {
    if (downloadStatus !== 'DOWNLOADING') return;
    setDownloadStatus('PAUSED');
    addLog(`Paused ${selectedOS.name} download.`, 'warn');
  };

  const handleCancelDownload = () => {
    setDownloadStatus('IDLE');
    setDownloadProgress(0);
    setTimeRemaining(0);
    addLog(`Cancelled ${selectedOS.name} download.`, 'error');
  };

  const handleCustomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const name = prompt("Enter OS Name:", file.name.replace(/\.[^/.]+$/, ""));
    const version = prompt("Enter Version:", "1.0.0");
    const checksum = prompt("Enter SHA256 Checksum (optional):", "sha256:manual_entry");

    if (!name || !version) {
      addLog('Custom upload cancelled: Name and Version are required.', 'warn');
      return;
    }

    const newOS: OSVersion = {
      id: `custom-${Date.now()}`,
      name: `[CUSTOM] ${name}`,
      version,
      description: `User uploaded image: ${file.name}`,
      checksum: checksum || 'sha256:unverified'
    };

    setCustomOSList(prev => [...prev, newOS]);
    setDownloadedImages(prev => new Set(prev).add(newOS.id));
    setSelectedOS(newOS);
    addLog(`Custom OS image "${name}" uploaded and registered.`, 'success');
  };

  const handleVerifyChecksum = async () => {
    if (isVerifying || deviceState !== 'IDLE') return;
    setIsVerifying(true);
    addLog(`Starting integrity verification for ${selectedOS.name}...`, 'info');
    
    // Simulate a real checksum calculation process
    const steps = [
      { msg: 'Calculating local image hash...', duration: 1500 },
      { msg: `Local hash: ${selectedOS.checksum.substring(0, 24)}...`, duration: 500 },
      { msg: 'Comparing with official manifest...', duration: 1000 },
    ];

    for (const step of steps) {
      addLog(step.msg, 'info');
      await new Promise(r => setTimeout(r, step.duration));
    }

    // Simulate failure for unverified custom images
    if (selectedOS.checksum === 'sha256:unverified') {
      setIsChecksumVerified(false);
      setIsVerifying(false);
      addLog('Error: Integrity verification FAILED. Image is potentially corrupt or tampered.', 'error');
      return;
    }

    setIsChecksumVerified(true);
    setIsVerifying(false);
    addLog('Integrity verification successful. Image is authentic.', 'success');
  };

  const handleBootloaderToggle = async () => {
    if (deviceState !== 'IDLE') return;
    if (connectionStatus !== 'CONNECTED') {
      addLog('Error: Device must be connected to toggle bootloader.', 'error');
      return;
    }
    
    if (isBootloaderLocked) {
      setShowUnlockModal(true);
    } else {
      await simulateProcess('RESETTING', [
        { msg: 'Relocking bootloader...', duration: 1000 },
        { msg: 'Verifying system integrity...', duration: 1200 },
        { msg: 'Bootloader locked successfully.', duration: 500, type: 'success' },
      ]);
      setIsBootloaderLocked(true);
    }
  };

  const confirmBootloaderUnlock = async () => {
    setShowUnlockModal(false);
    await simulateProcess('RESETTING', [
      { msg: 'Initiating bootloader unlock request...', duration: 1000 },
      { msg: 'WARNING: All user data will be wiped.', duration: 500, type: 'warn' },
      { msg: 'Wiping userdata and metadata partitions...', duration: 2000 },
      { msg: 'Generating new cryptographic keys...', duration: 1500 },
      { msg: 'Bootloader unlocked successfully.', duration: 500, type: 'success' },
    ]);
    setIsBootloaderLocked(false);
  };

  const handleProvisionNetwork = async () => {
    if (deviceState !== 'IDLE') return;
    if (connectionStatus !== 'CONNECTED') {
      addLog('Error: Device must be connected to provision network.', 'error');
      return;
    }
    if (selectedDevice.isNetworkLocked) {
      addLog('Error: Network is locked. Please unlock network before provisioning.', 'error');
      return;
    }
    try {
      await simulateProcess('PROVISIONING', [
        { msg: `Contacting ${selectedProvider} servers...`, duration: 1200 },
        { msg: 'Requesting eSIM profile...', duration: 1500 },
        { msg: 'Downloading provisioning data...', duration: 1000 },
        { msg: 'Updating cellular radio firmware...', duration: 1800 },
        { msg: 'Network provisioned successfully.', duration: 500, type: 'success' },
      ]);
      addHistoryEntry('Network Provision', selectedProvider, 'SUCCESS');
    } catch (e) {
      addHistoryEntry('Network Provision', selectedProvider, 'FAILED');
    }
  };

  const handleNetworkUnlock = async () => {
    if (deviceState !== 'IDLE' || connectionStatus !== 'CONNECTED') return;
    
    await simulateProcess('PROVISIONING', [
      { msg: 'Requesting network unlock code...', duration: 1500 },
      { msg: 'Verifying carrier eligibility...', duration: 1200 },
      { msg: 'Injecting unlock token into radio firmware...', duration: 2000 },
      { msg: 'Network unlocked successfully.', duration: 500, type: 'success' },
    ]);
    
    setSelectedDevice(prev => ({ ...prev, isNetworkLocked: false }));
    addHistoryEntry('Network Unlock', selectedDevice.name, 'SUCCESS');
  };

  const handleAIUnlock = async () => {
    if (deviceState !== 'IDLE' || connectionStatus !== 'CONNECTED') {
      addLog('Error: Device must be connected for AI analysis.', 'error');
      return;
    }

    setIsAiAnalyzing(true);
    addLog('AI Assistant: Analyzing device security state...', 'info');

    try {
      const model = "gemini-3-flash-preview";
      const prompt = `Analyze this device state and recommend a sequence of unlock operations.
      Device: ${selectedDevice.name}
      CPU: ${selectedDevice.cpu}
      Network Locked: ${selectedDevice.isNetworkLocked}
      Bootloader Locked: ${isBootloaderLocked}
      
      Provide a concise summary of the security state and the recommended steps to fully unlock the device for custom firmware.`;

      const response = await genAI.models.generateContent({
        model,
        contents: prompt,
      });

      const analysis = response.text || "Unable to analyze device state.";
      setAiAnalysis(analysis);
      addLog('AI Assistant: Analysis complete.', 'success');

      // Auto-execute if locked
      if (selectedDevice.isNetworkLocked || isBootloaderLocked) {
        addLog('AI Assistant: Initiating automated unlock sequence...', 'warn');
        
        if (selectedDevice.isNetworkLocked) {
          await handleNetworkUnlock();
        }
        
        if (isBootloaderLocked) {
          addLog('AI Assistant: Bootloader lock detected. Requesting unlock...', 'info');
          // Automatically trigger the unlock modal for user confirmation
          setTimeout(() => setShowUnlockModal(true), 1000);
        }
      } else {
        addLog('AI Assistant: Device is already fully unlocked.', 'success');
      }
    } catch (error) {
      console.error("AI Analysis Error:", error);
      addLog('AI Assistant: Error during analysis.', 'error');
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  const handleSendChatMessage = async () => {
    if (!chatInput.trim() || isChatLoading) return;
    
    const userMsg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsChatLoading(true);
    
    try {
      const contents = chatMessages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));
      contents.push({ role: 'user', parts: [{ text: userMsg }] });
      
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: contents as any,
        config: {
          systemInstruction: "You are an expert AI assistant specializing in cellular devices, mobile provisioning, firmware flashing, and hardware troubleshooting. Guide the user through using this Odin-style flashing tool. Help them with issues like broken screens, OS reinstallation, bypassing forgotten PINs (via factory reset), and network provisioning. Be concise, technical but accessible, and proactive in guiding them."
        }
      });
      
      setChatMessages(prev => [...prev, { role: 'model', text: response.text || "I'm sorry, I couldn't process that request." }]);
    } catch (error) {
      console.error("Chat error:", error);
      setChatMessages(prev => [...prev, { role: 'model', text: "Connection error. Please try again." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#E4E3E0] font-mono">
        <div className="flex flex-col items-center gap-4">
          <Activity size={48} className="animate-pulse" />
          <span className="text-xs uppercase tracking-widest">Initializing Secure Terminal...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#E4E3E0] p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full border-2 border-black bg-white p-8 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]"
        >
          <div className="flex flex-col items-center text-center gap-6">
            <div className="p-4 bg-black text-white rounded-full">
              <Lock size={48} />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tighter uppercase italic font-serif mb-2">
                Terminal Access
              </h1>
              <p className="text-xs uppercase tracking-widest opacity-50 font-mono">
                Authentication Required // v2.4.0
              </p>
            </div>
            <div className="w-full h-px bg-black/10" />
            <p className="text-sm opacity-70">
              Please sign in with your authorized Google account to manage device operations and track history.
            </p>
            <button 
              onClick={loginWithGoogle}
              className="w-full flex items-center justify-center gap-3 bg-black text-white p-4 font-bold uppercase tracking-widest hover:bg-black/80 transition-all"
            >
              <LogIn size={20} />
              Sign In with Google
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 gap-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="border-b-4 border-black p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#f0f4f8]">
        <div>
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 text-white p-1.5 font-black text-xl italic tracking-tighter leading-none">
              ODIN
            </div>
            <h1 className="text-3xl font-black uppercase tracking-tighter italic font-serif">
              Flash Tool v3.14.4
            </h1>
          </div>
          <div className="flex items-center gap-4 mt-1">
            <p className="text-xs uppercase tracking-widest opacity-50 font-mono">
              SAMSUNG_MOBILE_USB_DRIVER: v2.17.11.0
            </p>
            <div className="h-3 w-px bg-black/20" />
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <UserIcon size={12} />
              <span className="opacity-70">{user.email}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-6 items-center font-mono text-xs">
          <div className="flex items-center gap-2">
            <Activity size={14} className="animate-pulse text-blue-600" />
            <span>LINK: ACTIVE</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldAlert size={14} className={isBootloaderLocked ? "text-red-600" : "text-green-600"} />
            <span>SECURE_BOOT: {isBootloaderLocked ? "LOCKED" : "UNLOCKED"}</span>
          </div>
          <button 
            onClick={logout}
            className="flex items-center gap-2 hover:underline uppercase font-bold text-red-600"
          >
            <LogOut size={14} />
            Logout
          </button>
        </div>
      </header>

      <main className="flex flex-col gap-4 flex-1 p-4 bg-[#e1e8ef]">
        {/* ID:COM Status Grid */}
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="border border-gray-400 bg-white p-1 flex flex-col items-center gap-1">
              <div className="text-[9px] font-bold text-gray-500 uppercase">ID:COM</div>
              <div className={`w-full h-6 flex items-center justify-center text-[10px] font-bold ${i === 0 && connectionStatus === 'CONNECTED' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                {i === 0 && connectionStatus === 'CONNECTED' ? '0:[COM3]' : `[COM${i+4}]`}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
          {/* Left: Options */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <section className="border border-gray-400 bg-white p-4 h-full">
              <h2 className="text-[10px] font-bold uppercase mb-4 border-b border-gray-200 pb-1">Options</h2>
              <div className="space-y-3">
                {Object.entries(odinOptions).map(([key, value]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={value}
                      onChange={() => setOdinOptions(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))}
                      className="w-3 h-3 accent-blue-600"
                    />
                    <span className="text-[10px] font-bold uppercase opacity-70 group-hover:opacity-100">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="border border-gray-400 bg-white p-4">
              <h2 className="text-[10px] font-bold uppercase mb-4 border-b border-gray-200 pb-1">Network</h2>
              <div className="space-y-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] font-bold uppercase opacity-50">Provider</label>
                  <select 
                    value={selectedProvider}
                    onChange={(e) => setSelectedProvider(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 py-1 px-2 text-[10px] font-mono outline-none"
                  >
                    {PROVIDERS.map(provider => (
                      <option key={provider} value={provider}>{provider}</option>
                    ))}
                  </select>
                </div>
                <button 
                  onClick={handleProvisionNetwork}
                  disabled={deviceState !== 'IDLE' || connectionStatus !== 'CONNECTED' || selectedDevice.isNetworkLocked}
                  className="w-full border-2 border-blue-600 text-blue-600 font-black py-2 text-[10px] uppercase italic tracking-tighter hover:bg-blue-50 disabled:opacity-30"
                >
                  Provision
                </button>
                {selectedDevice.isNetworkLocked && (
                  <button 
                    onClick={handleNetworkUnlock}
                    disabled={deviceState !== 'IDLE' || connectionStatus !== 'CONNECTED'}
                    className="w-full border-2 border-purple-600 text-purple-600 font-black py-2 text-[10px] uppercase italic tracking-tighter hover:bg-purple-50 disabled:opacity-30"
                  >
                    Unlock Network
                  </button>
                )}
              </div>
            </section>
          </div>

          {/* Center: File Slots */}
          <div className="lg:col-span-6 flex flex-col gap-4">
            <section className="border border-gray-400 bg-white p-4 flex-1">
              <div className="flex justify-between items-center mb-4 border-b border-gray-200 pb-1">
                <h2 className="text-[10px] font-bold uppercase">Files</h2>
                <div className="flex gap-2">
                  <button 
                    onClick={handleVerifyChecksum}
                    disabled={isVerifying || deviceState !== 'IDLE' || isChecksumVerified}
                    className={`text-[9px] font-bold uppercase ${isChecksumVerified ? 'text-green-600' : 'text-blue-600'} hover:underline disabled:opacity-30`}
                  >
                    {isChecksumVerified ? 'Verified' : 'Verify'}
                  </button>
                  <button 
                    onClick={() => {
                      setFileSlots({ BL: '', AP: '', CP: '', CSC: '', USERDATA: '' });
                      setIsChecksumVerified(false);
                    }}
                    className="text-[9px] font-bold uppercase text-blue-600 hover:underline"
                  >
                    Reset
                  </button>
                </div>
              </div>
              
              <div className="space-y-2">
                {['BL', 'AP', 'CP', 'CSC', 'USERDATA'].map(slot => (
                  <div key={slot} className="flex gap-2">
                    <button 
                      onClick={() => handleFileSelect(slot)}
                      className={`w-20 border border-gray-400 py-2 text-[10px] font-bold uppercase transition-colors ${fileSlots[slot] ? 'bg-blue-600 text-white border-blue-700' : 'bg-gray-100 hover:bg-gray-200'}`}
                    >
                      {slot}
                    </button>
                    <div className="flex-1 border border-gray-400 bg-gray-50 px-3 flex items-center overflow-hidden">
                      <span className="text-[10px] font-mono truncate opacity-60">
                        {fileSlots[slot] || `[Select ${slot} file...]`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex gap-4">
                <button 
                  onClick={handleOSInstall}
                  disabled={deviceState !== 'IDLE' || connectionStatus !== 'CONNECTED'}
                  className="flex-1 bg-blue-600 text-white font-black py-4 uppercase italic tracking-tighter hover:bg-blue-700 disabled:opacity-30 disabled:grayscale"
                >
                  Start
                </button>
                <button 
                  onClick={() => {
                    setDeviceState('IDLE');
                    setProgress(0);
                    addLog('Operation aborted by user.', 'warn');
                  }}
                  className="flex-1 border-2 border-gray-400 font-black py-4 uppercase italic tracking-tighter hover:bg-gray-100"
                >
                  Reset
                </button>
              </div>
            </section>

            {/* Progress Monitor */}
            <section className="border border-gray-400 bg-white p-4">
              <div className="flex justify-between items-end mb-2">
                <h2 className="text-[10px] font-bold uppercase">Progress</h2>
                <span className="font-mono text-[10px]">{deviceState !== 'IDLE' ? `${Math.round(progress)}%` : '0%'}</span>
              </div>
              <div className="h-6 border border-gray-400 p-[1px] bg-gray-100">
                <motion.div 
                  className="h-full bg-blue-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
                />
              </div>
            </section>
          </div>

          {/* Right: Log & Device Info */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <section className="border border-gray-400 bg-white flex flex-col h-[400px]">
              <div className="p-2 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                <span className="text-[10px] font-bold uppercase">Log</span>
                <button onClick={() => setLogs([])} className="text-[9px] text-blue-600 hover:underline uppercase">Clear</button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px] bg-white custom-scrollbar-light">
                {logs.map((log) => (
                  <div key={log.id} className="mb-1 flex gap-2">
                    <span className="opacity-40 shrink-0">&lt;ID:{log.timestamp}&gt;</span>
                    <span className={`
                      ${log.type === 'error' ? 'text-red-600' : ''}
                      ${log.type === 'warn' ? 'text-orange-600' : ''}
                      ${log.type === 'success' ? 'text-blue-600' : ''}
                      ${log.type === 'info' ? 'text-gray-800' : ''}
                    `}>
                      {log.message}
                    </span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </section>

            <section className="border border-gray-400 bg-white p-4">
              <div className="flex justify-between items-center mb-3 border-b border-gray-200 pb-1">
                <h2 className="text-[10px] font-bold uppercase">Device Info</h2>
                <div className="flex gap-2">
                  <button 
                    onClick={handleAIUnlock}
                    disabled={isAiAnalyzing || connectionStatus !== 'CONNECTED'}
                    className="flex items-center gap-1 text-[9px] font-bold uppercase text-purple-600 hover:underline disabled:opacity-30"
                  >
                    <Sparkles size={10} />
                    AI Unlock
                  </button>
                  <button 
                    onClick={handleAutoDetect}
                    className="text-[9px] font-bold uppercase text-blue-600 hover:underline"
                  >
                    Scan
                  </button>
                  <button 
                    onClick={handleManualDeviceRegistration}
                    className="text-[9px] font-bold uppercase text-blue-600 hover:underline"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {aiAnalysis && (
                  <div className="mb-3 p-3 bg-purple-50 border border-purple-200 rounded-sm relative group">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Brain size={12} className="text-purple-600" />
                        <span className="text-[9px] font-bold uppercase text-purple-800 tracking-tighter">AI Security Analysis</span>
                      </div>
                      <button 
                        onClick={() => setAiAnalysis(null)}
                        className="p-1 hover:bg-purple-100 rounded-full transition-colors"
                        title="Dismiss Analysis"
                      >
                        <X size={12} className="text-purple-600" />
                      </button>
                    </div>
                    <div className="text-[9px] text-purple-900 leading-relaxed prose prose-invert prose-p:my-1 prose-headings:text-[10px] prose-headings:my-1 prose-ul:my-1 prose-li:my-0">
                      <ReactMarkdown>{aiAnalysis}</ReactMarkdown>
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-1 mb-2">
                  <label className="text-[9px] font-bold uppercase opacity-50">Select Device</label>
                  <select 
                    value={selectedDevice.id}
                    onChange={(e) => {
                      const allDevices = [...DEVICE_MODELS, ...customDevices];
                      setSelectedDevice(allDevices.find(d => d.id === e.target.value) || allDevices[0]);
                    }}
                    className="w-full bg-gray-50 border border-gray-300 py-1 px-2 text-[10px] font-mono outline-none"
                  >
                    <optgroup label="Supported Models">
                      {DEVICE_MODELS.map(device => (
                        <option key={device.id} value={device.id}>{device.name}</option>
                      ))}
                    </optgroup>
                    {customDevices.length > 0 && (
                      <optgroup label="Custom Registered">
                        {customDevices.map(device => (
                          <option key={device.id} value={device.id}>{device.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="opacity-60">Model:</span>
                  <span className="font-bold">{selectedDevice.name}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="opacity-60">Status:</span>
                  <span className={`font-bold ${connectionStatus === 'CONNECTED' ? 'text-green-600' : 'text-red-600'}`}>{connectionStatus}</span>
                </div>
                <div className="flex justify-between items-center text-[10px]">
                  <span className="opacity-60">Bootloader:</span>
                  <div className="flex items-center gap-2">
                    <span className={`font-bold ${isBootloaderLocked ? 'text-red-600' : 'text-green-600'}`}>
                      {isBootloaderLocked ? 'LOCKED' : 'UNLOCKED'}
                    </span>
                    {isBootloaderLocked && connectionStatus === 'CONNECTED' && (
                      <button 
                        onClick={handleBootloaderToggle}
                        className="text-[9px] font-bold uppercase text-blue-600 hover:underline"
                      >
                        Unlock
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* Setup Guide Checklist (Simplified) */}
        <section className="border border-gray-400 bg-white p-3">
          <div className="flex items-center gap-3 mb-2">
            <ListChecks size={14} />
            <h2 className="font-bold uppercase text-[10px]">Setup Guide</h2>
          </div>
          <div className="flex flex-wrap gap-4">
            {[
              { title: "Connect", done: connectionStatus === 'CONNECTED' },
              { title: "Download", done: downloadedImages.has(selectedOS.id) },
              { title: "Verify", done: isChecksumVerified },
              { title: "Unlock", done: !isBootloaderLocked },
              { title: "Flash", done: history.some(h => h.operation === 'Firmware Flash' && h.status === 'SUCCESS') }
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`w-3 h-3 border border-gray-400 flex items-center justify-center ${step.done ? 'bg-blue-600 border-blue-700' : 'bg-white'}`}>
                  {step.done && <CheckCircle size={10} className="text-white" />}
                </div>
                <span className={`text-[10px] font-bold uppercase ${step.done ? 'text-blue-600' : 'opacity-40'}`}>{step.title}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Global Overlay for active states */}
      <AnimatePresence>
        {showUnlockModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="max-w-md w-full bg-white border-2 border-black p-8 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]"
            >
              <div className="flex flex-col gap-6">
                <div className="flex items-center gap-4 text-red-600">
                  <ShieldAlert size={32} />
                  <h3 className="text-xl font-bold uppercase tracking-tighter italic font-serif">
                    Security Warning
                  </h3>
                </div>
                
                <div className="space-y-4">
                  <p className="text-sm font-bold uppercase text-red-600">
                    Unlocking the bootloader will result in total data loss.
                  </p>
                  <p className="text-xs opacity-70 leading-relaxed">
                    This operation will wipe all user data, including photos, messages, and applications. 
                    It also reduces the device's security profile and may void your warranty.
                  </p>
                  <div className="p-3 bg-black/5 border-l-2 border-black italic text-[10px]">
                    "I understand that this action is irreversible and all data will be permanently erased."
                  </div>
                </div>

                <div className="flex gap-4">
                  <button 
                    onClick={() => setShowUnlockModal(false)}
                    className="flex-1 border border-black p-3 text-xs font-bold uppercase hover:bg-black/5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={confirmBootloaderUnlock}
                    className="flex-1 bg-red-600 text-white p-3 text-xs font-bold uppercase hover:bg-red-700 transition-colors"
                  >
                    Confirm Unlock
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showAddDeviceModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="max-w-lg w-full bg-white border-2 border-black p-8 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]"
            >
              <form onSubmit={submitManualDeviceRegistration} className="flex flex-col gap-6">
                <div className="flex items-center gap-4 text-blue-600">
                  <Smartphone size={32} />
                  <h3 className="text-xl font-bold uppercase tracking-tighter italic font-serif">
                    Register Custom Device
                  </h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase opacity-60">Brand & Model *</label>
                    <input 
                      required
                      type="text" 
                      value={newDeviceForm.name}
                      onChange={e => setNewDeviceForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. Nothing Phone 2"
                      className="w-full border border-gray-300 p-2 text-xs font-mono outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase opacity-60">Serial Number</label>
                    <input 
                      type="text" 
                      value={newDeviceForm.sn}
                      onChange={e => setNewDeviceForm(prev => ({ ...prev, sn: e.target.value }))}
                      className="w-full border border-gray-300 p-2 text-xs font-mono outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase opacity-60">CPU / Chipset</label>
                    <input 
                      type="text" 
                      value={newDeviceForm.cpu}
                      onChange={e => setNewDeviceForm(prev => ({ ...prev, cpu: e.target.value }))}
                      placeholder="e.g. Snapdragon 8+ Gen 1"
                      className="w-full border border-gray-300 p-2 text-xs font-mono outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase opacity-60">Storage</label>
                    <input 
                      type="text" 
                      value={newDeviceForm.storage}
                      onChange={e => setNewDeviceForm(prev => ({ ...prev, storage: e.target.value }))}
                      placeholder="e.g. 256GB"
                      className="w-full border border-gray-300 p-2 text-xs font-mono outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase opacity-60">RAM</label>
                    <input 
                      type="text" 
                      value={newDeviceForm.ram}
                      onChange={e => setNewDeviceForm(prev => ({ ...prev, ram: e.target.value }))}
                      placeholder="e.g. 12GB"
                      className="w-full border border-gray-300 p-2 text-xs font-mono outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase opacity-60">Battery Health (%)</label>
                    <input 
                      type="text" 
                      value={newDeviceForm.battery}
                      onChange={e => setNewDeviceForm(prev => ({ ...prev, battery: e.target.value }))}
                      placeholder="e.g. 98%"
                      className="w-full border border-gray-300 p-2 text-xs font-mono outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    id="networkLocked"
                    checked={newDeviceForm.isNetworkLocked}
                    onChange={e => setNewDeviceForm(prev => ({ ...prev, isNetworkLocked: e.target.checked }))}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <label htmlFor="networkLocked" className="text-xs font-bold uppercase cursor-pointer">
                    Device is Network Locked
                  </label>
                </div>

                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowAddDeviceModal(false)}
                    className="flex-1 border border-black p-3 text-xs font-bold uppercase hover:bg-black/5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-blue-600 text-white p-3 text-xs font-bold uppercase hover:bg-blue-700 transition-colors"
                  >
                    Register Device
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}

        {deviceState !== 'IDLE' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/10 backdrop-blur-[1px] pointer-events-none z-50 flex items-center justify-center"
          >
            <div className="bg-white border-2 border-black p-8 shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center gap-4">
              <div className="relative">
                <Activity size={48} className="animate-pulse" />
                <div className="absolute inset-0 animate-ping opacity-20">
                  <Activity size={48} />
                </div>
              </div>
              <div className="text-center">
                <h3 className="font-bold uppercase tracking-tighter text-xl">System Busy</h3>
                <p className="font-mono text-xs opacity-60">Do not disconnect device...</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Chat Widget */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end">
        <AnimatePresence>
          {isChatOpen && (
            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="mb-4 w-80 sm:w-96 bg-white border border-gray-400 shadow-2xl flex flex-col overflow-hidden"
              style={{ height: '500px', maxHeight: '80vh' }}
            >
              {/* Chat Header */}
              <div className="bg-blue-600 text-white p-3 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Bot size={16} />
                  <span className="text-[11px] font-bold uppercase tracking-wider">Device Expert AI</span>
                </div>
                <button onClick={() => setIsChatOpen(false)} className="hover:bg-blue-700 p-1 rounded transition-colors">
                  <X size={14} />
                </button>
              </div>
              
              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 bg-gray-50 flex flex-col gap-3 custom-scrollbar-light">
                {chatMessages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-3 text-[11px] ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-l-md rounded-tr-md' : 'bg-white border border-gray-200 text-gray-800 rounded-r-md rounded-tl-md shadow-sm'}`}>
                      {msg.role === 'model' ? (
                        <div className="prose prose-sm prose-p:my-1 prose-headings:text-[12px] prose-headings:my-1 prose-ul:my-1 prose-li:my-0 max-w-none">
                          <ReactMarkdown>{msg.text}</ReactMarkdown>
                        </div>
                      ) : (
                        msg.text
                      )}
                    </div>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-gray-200 text-gray-500 p-3 rounded-r-md rounded-tl-md text-[10px] italic flex items-center gap-1 shadow-sm">
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              
              {/* Chat Input */}
              <div className="p-2 bg-white border-t border-gray-200 flex gap-2">
                <input 
                  type="text" 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendChatMessage()}
                  placeholder="Ask about flashing, resets, or hardware..."
                  className="flex-1 bg-gray-100 border border-gray-300 px-3 py-2 text-[11px] outline-none focus:border-blue-500 transition-colors"
                />
                <button 
                  onClick={handleSendChatMessage}
                  disabled={!chatInput.trim() || isChatLoading}
                  className="bg-blue-600 text-white p-2 hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center"
                >
                  <Send size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        <button 
          onClick={() => setIsChatOpen(!isChatOpen)}
          className={`${isChatOpen ? 'bg-gray-800' : 'bg-blue-600'} text-white p-3 rounded-full shadow-lg hover:opacity-90 transition-all flex items-center justify-center`}
        >
          {isChatOpen ? <X size={20} /> : <MessageSquare size={20} />}
        </button>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.05);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.2);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.3);
        }
      `}</style>
    </div>
  );
}
