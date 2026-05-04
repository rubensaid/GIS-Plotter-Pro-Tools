import React, { useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import { 
  CoordType, 
  GeoShape, 
  Point, 
  SnappingSettings, 
  UTMCoordinate 
} from './types';
import { 
  cn, 
  utmToDecimal, 
  decimalToUtm, 
  calculateArea, 
  calculatePerimeter, 
  createOffsetPolygon,
  findNearbyPoint,
  parseKml,
  generateBufferFromLine,
  exportToKml,
  exportToCoordinateTable,
  getShapeBounds
} from './lib/utils';
import { 
  Map as MapIcon, 
  Layers, 
  Plus, 
  Trash2, 
  Settings2, 
  Maximize2,
  ChevronRight,
  ChevronLeft,
  MapPin,
  Move,
  Upload,
  Table as TableIcon,
  X,
  Check,
  Disc,
  Database,
  Info,
  Eye,
  EyeOff,
  Edit3,
  Clipboard,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Fixing Leaflet Default Icon issue
const DefaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    tooltipAnchor: [16, -28],
    shadowSize: [41, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

// --- Sub-components ---

const MapEvents = ({ 
  isDrawing, 
  onMapClick, 
  onMouseMove 
}: { 
  isDrawing: boolean, 
  onMapClick: (p: Point) => void, 
  onMouseMove: (p: Point) => void
}) => {
  useMapEvents({
    click(e) {
      if (isDrawing) {
        onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    },
    mousemove(e) {
      onMouseMove({ lat: e.latlng.lat, lng: e.latlng.lng });
    }
  });
  return null;
};

export default function App() {
  const [shapes, setShapes] = useState<GeoShape[]>([]);
  const [map, setMap] = useState<L.Map | null>(null);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [drawingType, setDrawingType] = useState<'polygon' | 'polyline' | 'none'>('none');
  const [hoverPos, setHoverPos] = useState<Point | null>(null);
  const [snappedPos, setSnappedPos] = useState<Point | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'create' | 'layers' | 'settings'>('create');
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [editingShapeId, setEditingShapeId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Snapping Settings
  const [snapping, setSnapping] = useState<SnappingSettings>({
    enabled: true,
    endpoints: true,
    midpoints: true,
    intersections: true,
    centers: true,
    threshold: 20 // meters
  });

  // Coordinate Input State
  const [coordType, setCoordType] = useState<CoordType>('UTM');
  const [decInput, setDecInput] = useState({ lat: '', lng: '' });
  const [utmInput, setUtmInput] = useState({ 
    easting: '', 
    northing: '', 
    zoneNum: '18', 
    zoneLetter: 'L' 
  });

  // Offset Setting
  const [offsetValue, setOffsetValue] = useState<number>(10);

  const isDrawing = drawingType !== 'none';
  const selectedShape = shapes.find(s => s.id === selectedShapeId);

  // --- Handlers ---

  const handleMapClick = useCallback((p: Point) => {
    const pointToUse = snappedPos || p;
    setCurrentPoints(prev => [...prev, pointToUse]);
  }, [snappedPos]);

  const handleMouseMove = useCallback((p: Point) => {
    setHoverPos(p);
    if (snapping.enabled) {
      const snapped = findNearbyPoint(p, shapes, snapping.threshold, snapping);
      setSnappedPos(snapped);
    } else {
      setSnappedPos(null);
    }
  }, [shapes, snapping]);

  const finishDrawing = () => {
    if (currentPoints.length < (drawingType === 'polygon' ? 3 : 2)) {
      setDrawingType('none');
      setCurrentPoints([]);
      return;
    }

    const newShape: GeoShape = {
      id: Math.random().toString(36).substring(2, 11),
      type: drawingType as 'polygon' | 'polyline',
      points: currentPoints,
      name: `${drawingType === 'polygon' ? 'Polígono' : 'Trazo'} ${shapes.length + 1}`,
      color: '#3b82f6',
      visible: true,
      area: drawingType === 'polygon' ? calculateArea(currentPoints) : 0,
      perimeter: calculatePerimeter(currentPoints, drawingType === 'polygon')
    };

    setShapes([...shapes, newShape]);
    setDrawingType('none');
    setCurrentPoints([]);
    setSelectedShapeId(newShape.id);
  };

  const addPointFromInput = () => {
    let point: Point | null = null;
    if (coordType === 'Decimal') {
      const lat = parseFloat(decInput.lat);
      const lng = parseFloat(decInput.lng);
      if (!isNaN(lat) && !isNaN(lng)) point = { lat, lng };
    } else {
      const easting = parseFloat(utmInput.easting);
      const northing = parseFloat(utmInput.northing);
      const zoneNum = parseInt(utmInput.zoneNum);
      if (!isNaN(easting) && !isNaN(northing) && !isNaN(zoneNum)) {
        point = utmToDecimal({ easting, northing, zoneNum, zoneLetter: utmInput.zoneLetter });
      }
    }

    if (point) {
      if (!isDrawing) setDrawingType('polygon');
      setCurrentPoints(prev => [...prev, point!]);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const newShapes = await parseKml(file);
      setShapes(prev => [...prev, ...newShapes]);
      setActiveTab('layers');
    } catch (err) {
      console.error('Error importing KML/KMZ:', err);
      alert('Error al importar archivo. Verifique el formato.');
    }
  };

  const createOffset = (shape: GeoShape) => {
    if (shape.type !== 'polygon') return;
    const newPoints = createOffsetPolygon(shape.points, offsetValue);
    if (newPoints.length > 0) {
      const newShape: GeoShape = {
        id: Math.random().toString(36).substring(2, 11),
        type: 'polygon',
        points: newPoints,
        name: `${shape.name} Offset (${offsetValue}m)`,
        color: '#60a5fa',
        visible: true,
        area: calculateArea(newPoints),
        perimeter: calculatePerimeter(newPoints, true)
      };
      setShapes([...shapes, newShape]);
      setSelectedShapeId(newShape.id);
    }
  };

  const createBuffer = (shape: GeoShape) => {
    if (shape.type !== 'polyline') return;
    const newPoints = generateBufferFromLine(shape.points, offsetValue);
    if (newPoints.length > 0) {
      const newShape: GeoShape = {
        id: Math.random().toString(36).substring(2, 11),
        type: 'polygon',
        points: newPoints,
        name: `${shape.name} Faja (${offsetValue}m)`,
        color: '#f59e0b',
        visible: true,
        area: calculateArea(newPoints),
        perimeter: calculatePerimeter(newPoints, true)
      };
      setShapes([...shapes, newShape]);
      setSelectedShapeId(newShape.id);
    }
  };

  const closePolyline = (shape: GeoShape) => {
    if (shape.type !== 'polyline') return;
    setShapes(prev => prev.map(s => 
      s.id === shape.id 
        ? { 
            ...s, 
            type: 'polygon', 
            area: calculateArea(s.points),
            perimeter: calculatePerimeter(s.points, true)
          } 
        : s
    ));
  };

  const toggleVisibility = (id: string) => {
    setShapes(prev => prev.map(s => s.id === id ? { ...s, visible: !s.visible } : s));
  };

  const startRenaming = (shape: GeoShape) => {
    setEditingShapeId(shape.id);
    setNewName(shape.name);
  };

  const saveRename = () => {
    if (!editingShapeId) return;
    setShapes(prev => prev.map(s => s.id === editingShapeId ? { ...s, name: newName } : s));
    setEditingShapeId(null);
  };

  const downloadKml = () => {
    const shapeToExport = shapes.find(s => s.id === selectedShapeId);
    if (!shapeToExport) return;
    
    const kml = exportToKml([shapeToExport]);
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${shapeToExport.name}.kml`;
    a.click();
  };

  const copyCoordTable = () => {
    const shapeToCopy = shapes.find(s => s.id === selectedShapeId);
    if (!shapeToCopy) return;

    const table = exportToCoordinateTable([shapeToCopy]);
    navigator.clipboard.writeText(table).then(() => {
      alert(`Cuadro de coordenadas de "${shapeToCopy.name}" copiado al portapapeles`);
    });
  };

  const handleLayerDoubleClick = (shape: GeoShape) => {
    if (!map) return;
    const bounds = getShapeBounds(shape);
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
    }
  };

  // --- Rendering ---

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] text-[#e0e0e0] font-sans overflow-hidden">
      
      {/* Header Navigation */}
      <header className="h-16 border-b border-[#2a2a2a] bg-[#111111] px-6 flex items-center justify-between shrink-0 z-[1100]">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-[0_0_20px_-5px_rgba(37,99,235,0.5)]">
            <MapIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-[0.2em] uppercase text-white">GIS PRO TOOLS</h1>
            <p className="text-[10px] text-[#666] uppercase tracking-wider font-medium">Cartografía de Precisión</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex bg-[#1a1a1a] rounded-lg p-1 border border-[#333]">
            <button 
              onClick={() => setCoordType('UTM')}
              className={cn(
                "px-4 py-1 text-[10px] font-bold rounded transition-all",
                coordType === 'UTM' ? "bg-blue-600 text-white shadow-lg" : "text-[#888] hover:text-white"
              )}
            >
              UTM (WGS84)
            </button>
            <button 
              onClick={() => setCoordType('Decimal')}
              className={cn(
                "px-4 py-1 text-[10px] font-bold rounded transition-all",
                coordType === 'Decimal' ? "bg-blue-600 text-white shadow-lg" : "text-[#888] hover:text-white"
              )}
            >
              DECIMAL
            </button>
          </div>
          
          <div className="h-8 w-px bg-[#2a2a2a]" />
          
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase text-[#666] font-bold">Estado:</span>
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-bold text-emerald-500 uppercase">Sistema Listo</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        
        {/* Tool Sidebar */}
        <aside className="w-16 border-r border-[#2a2a2a] bg-[#111111] flex flex-col items-center py-6 gap-6 shrink-0">
          <button 
            onClick={() => setActiveTab('create')}
            className={cn(
              "p-2.5 rounded-xl transition-all cursor-pointer",
              activeTab === 'create' ? "bg-blue-600/20 text-blue-500 ring-1 ring-blue-500/50 shadow-[0_0_15px_rgba(37,99,235,0.2)]" : "text-[#666] hover:bg-[#1a1a1a] hover:text-white"
            )}
          >
            <Plus className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setActiveTab('layers')}
            className={cn(
              "p-2.5 rounded-xl transition-all cursor-pointer",
              activeTab === 'layers' ? "bg-blue-600/20 text-blue-500 ring-1 ring-blue-500/50 shadow-[0_0_15px_rgba(37,99,235,0.2)]" : "text-[#666] hover:bg-[#1a1a1a] hover:text-white"
            )}
          >
            <Layers className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={cn(
              "p-2.5 rounded-xl transition-all cursor-pointer",
              activeTab === 'settings' ? "bg-blue-600/20 text-blue-500 ring-1 ring-blue-500/50 shadow-[0_0_15px_rgba(37,99,235,0.2)]" : "text-[#666] hover:bg-[#1a1a1a] hover:text-white"
            )}
          >
            <Settings2 className="w-5 h-5" />
          </button>

          <div className="w-8 h-px bg-[#2a2a2a]" />

          <div 
            className={cn(
              "p-2.5 rounded-xl transition-all",
              snapping.enabled ? "bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/40" : "text-[#444]"
            )} 
            title="Snap Status"
          >
            <Disc className="w-5 h-5" />
          </div>
        </aside>

        {/* Tab Content Sidebar */}
        <motion.aside 
          initial={false}
          animate={{ width: sidebarOpen ? 340 : 0 }}
          className="bg-[#0f0f0f] border-r border-[#2a2a2a] relative overflow-hidden"
        >
          <div className="w-[340px] h-full flex flex-col p-6 space-y-8">
            <AnimatePresence mode="wait">
              {activeTab === 'create' && (
                <motion.div 
                  key="tab-create"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-8"
                >
                  <section className="space-y-4">
                    <h2 className="text-xs font-bold text-[#666] uppercase tracking-widest">Herramientas de Dibujo</h2>
                    <div className="grid grid-cols-2 gap-3">
                      <button 
                         onClick={() => { setDrawingType('polygon'); setCurrentPoints([]); }}
                         className={cn(
                           "flex flex-col items-center justify-center gap-3 p-4 rounded-xl border transition-all",
                           drawingType === 'polygon' 
                             ? "bg-blue-600/10 border-blue-500/50 text-blue-500" 
                             : "bg-[#1a1a1a] border-[#333] text-[#888] hover:border-[#444]"
                         )}
                      >
                        <Layers className="w-5 h-5" />
                        <span className="text-[10px] font-bold uppercase">Polígono</span>
                      </button>
                      <button 
                         onClick={() => { setDrawingType('polyline'); setCurrentPoints([]); }}
                         className={cn(
                           "flex flex-col items-center justify-center gap-3 p-4 rounded-xl border transition-all",
                           drawingType === 'polyline' 
                             ? "bg-blue-600/10 border-blue-500/50 text-blue-500" 
                             : "bg-[#1a1a1a] border-[#333] text-[#888] hover:border-[#444]"
                         )}
                      >
                        <Move className="w-5 h-5" />
                        <span className="text-[10px] font-bold uppercase">Trazo</span>
                      </button>
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h2 className="text-xs font-bold text-[#666] uppercase tracking-widest flex justify-between">
                      Importación
                      <Info className="w-3 h-3 text-[#333]" />
                    </h2>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileUpload} 
                      accept=".kml,.kmz" 
                      className="hidden" 
                    />
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full bg-[#1a1a1a] border border-[#333] border-dashed rounded-xl py-6 flex flex-col items-center gap-3 text-[#666] hover:border-blue-500/50 hover:text-blue-500 transition-all group"
                    >
                      <Upload className="w-6 h-6 group-hover:scale-110 transition-transform" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Subir KML / KMZ</span>
                    </button>
                  </section>

                  <section className="space-y-4 bg-[#111111] p-5 rounded-2xl border border-[#2a2a2a]">
                    <h2 className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.2em] mb-4">Ingreso de Puntos</h2>
                    {coordType === 'Decimal' ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <span className="text-[9px] font-bold text-[#444] uppercase tracking-widest ml-1">Latitud</span>
                          <input 
                            type="text" 
                            value={decInput.lat}
                            onChange={(e) => setDecInput(prev => ({ ...prev, lat: e.target.value }))}
                            className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg py-2 px-3 text-xs text-white focus:border-blue-500 outline-none"
                            placeholder="-12.04"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <span className="text-[9px] font-bold text-[#444] uppercase tracking-widest ml-1">Longitud</span>
                          <input 
                            type="text" 
                            value={decInput.lng}
                            onChange={(e) => setDecInput(prev => ({ ...prev, lng: e.target.value }))}
                            className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg py-2 px-3 text-xs text-white focus:border-blue-500 outline-none"
                            placeholder="-77.04"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <span className="text-[9px] font-bold text-[#444] uppercase tracking-widest ml-1">Este (X)</span>
                            <input 
                              type="text" 
                              value={utmInput.easting}
                              onChange={(e) => setUtmInput(prev => ({ ...prev, easting: e.target.value }))}
                              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg py-2 px-3 text-xs text-white focus:border-blue-500 outline-none"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <span className="text-[9px] font-bold text-[#444] uppercase tracking-widest ml-1">Norte (Y)</span>
                            <input 
                              type="text" 
                              value={utmInput.northing}
                              onChange={(e) => setUtmInput(prev => ({ ...prev, northing: e.target.value }))}
                              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg py-2 px-3 text-xs text-white focus:border-blue-500 outline-none"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <span className="text-[9px] font-bold text-[#444] uppercase tracking-widest ml-1">Zona</span>
                            <input 
                              type="text" 
                              value={utmInput.zoneNum}
                              onChange={(e) => setUtmInput(prev => ({ ...prev, zoneNum: e.target.value }))}
                              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg py-2 px-3 text-xs text-white focus:border-blue-500 outline-none"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <span className="text-[9px] font-bold text-[#444] uppercase tracking-widest ml-1">Letra</span>
                            <input 
                              type="text" 
                              value={utmInput.zoneLetter}
                              onChange={(e) => setUtmInput(prev => ({ ...prev, zoneLetter: e.target.value }))}
                              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg py-2 px-3 text-xs text-white focus:border-blue-500 outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                    <button 
                      onClick={addPointFromInput}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all shadow-[0_10px_20px_-5px_rgba(37,99,235,0.4)]"
                    >
                      Añadir a Secuencia
                    </button>
                  </section>
                </motion.div>
              )}

              {activeTab === 'layers' && (
                <motion.div 
                  key="tab-layers"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4 h-full flex flex-col"
                >
                  <h2 className="text-xs font-bold text-[#666] uppercase tracking-widest">Capas Activas ({shapes.length})</h2>
                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {shapes.map(shape => (
                      <div 
                        key={shape.id}
                        onDoubleClick={() => handleLayerDoubleClick(shape)}
                        onClick={() => setSelectedShapeId(shape.id)}
                        className={cn(
                          "p-4 rounded-xl border transition-all cursor-pointer group relative overflow-hidden",
                          selectedShapeId === shape.id 
                            ? "bg-blue-600/10 border-blue-500/50" 
                            : "bg-[#111111] border-[#2a2a2a] hover:border-[#444]"
                        )}
                      >
                        {selectedShapeId === shape.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500" />}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3 flex-1 overflow-hidden">
                            <div className="w-2 h-2 shrink-0 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.2)]" style={{ backgroundColor: shape.color }}></div>
                            {editingShapeId === shape.id ? (
                               <div className="flex gap-1 flex-1">
                                 <input 
                                   autoFocus
                                   value={newName}
                                   onChange={(e) => setNewName(e.target.value)}
                                   onKeyDown={(e) => e.key === 'Enter' && saveRename()}
                                   className="bg-[#2a2a2a] border border-blue-500 rounded px-1.5 py-0.5 text-[10px] text-white w-full outline-none"
                                 />
                                 <button onClick={(e) => { e.stopPropagation(); saveRename(); }} className="text-emerald-500"><Check className="w-3 h-3" /></button>
                               </div>
                            ) : (
                               <span className="text-[11px] font-bold text-white uppercase truncate tracking-wider">{shape.name}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                             <button 
                                onClick={(e) => { e.stopPropagation(); toggleVisibility(shape.id); }}
                                className="text-[#444] hover:text-white transition-colors"
                             >
                               {shape.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                             </button>
                             <button 
                                onClick={(e) => { e.stopPropagation(); startRenaming(shape); }}
                                className="text-[#444] hover:text-white transition-colors"
                             >
                               <Edit3 className="w-3.5 h-3.5" />
                             </button>
                             <button 
                                onClick={(e) => { e.stopPropagation(); setShapes(prev => prev.filter(s => s.id !== shape.id)); if (selectedShapeId === shape.id) setSelectedShapeId(null); }}
                                className="text-[#444] hover:text-red-500 transition-colors"
                             >
                                <Trash2 className="w-3.5 h-3.5" />
                             </button>
                          </div>
                        </div>
                        
                        <div className="flex gap-4 mb-3">
                           <div>
                             <p className="text-[8px] text-[#444] uppercase font-black">Perímetro</p>
                             <p className="text-xs font-mono text-[#ccc]">{(shape.perimeter ?? 0).toFixed(2)}m</p>
                           </div>
                           {shape.type === 'polygon' && (
                             <div>
                               <p className="text-[8px] text-[#444] uppercase font-black">Área</p>
                               <p className="text-xs font-mono text-[#ccc]">{(shape.area ?? 0).toFixed(2)}m²</p>
                             </div>
                           )}
                        </div>
                        
                        {shape.type === 'polyline' && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); closePolyline(shape); }}
                            className="w-full mt-2 py-1.5 bg-blue-600/10 border border-blue-500/20 hover:bg-blue-600/20 text-blue-400 text-[9px] font-bold uppercase tracking-widest rounded-lg flex items-center justify-center gap-2"
                          >
                            <Check className="w-3 h-3" /> Cerrar Polígono
                          </button>
                        )}
                      </div>
                    ))}
                    {shapes.length === 0 && (
                      <div className="py-20 text-center opacity-20 flex flex-col items-center gap-4">
                        <Database className="w-12 h-12" />
                        <span className="text-xs font-bold uppercase tracking-widest text-[#444]">Sin Capas</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeTab === 'settings' && (
                <motion.div 
                  key="tab-settings"
                  className="space-y-8"
                >
                  <section className="space-y-4">
                    <h2 className="text-xs font-bold text-[#666] uppercase tracking-widest">Control de Snap</h2>
                    <div className="bg-[#111111] p-5 rounded-2xl border border-[#2a2a2a] space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-[#ccc] font-medium uppercase tracking-wider">Habilitar Iman</span>
                        <button 
                          onClick={() => setSnapping(prev => ({ ...prev, enabled: !prev.enabled }))}
                          className={cn(
                            "w-10 h-5 rounded-full p-1 transition-all",
                            snapping.enabled ? "bg-blue-600" : "bg-[#333]"
                          )}
                        >
                          <div className={cn("w-3 h-3 bg-white rounded-full transition-all", snapping.enabled ? "translate-x-5" : "translate-x-0")} />
                        </button>
                      </div>
                      
                      {snapping.enabled && (
                        <div className="space-y-4 pt-4 border-t border-[#1a1a1a]">
                           {[
                             { id: 'endpoints', label: 'Extremos' },
                             { id: 'midpoints', label: 'Puntos Medios' },
                             { id: 'centers', label: 'Centros' },
                             { id: 'intersections', label: 'Intersecciones' }
                           ].map(opt => (
                             <label key={opt.id} className="flex items-center gap-3 cursor-pointer group">
                               <input 
                                 type="checkbox" 
                                 checked={(snapping as any)[opt.id]}
                                 onChange={(e) => setSnapping(prev => ({ ...prev, [opt.id]: e.target.checked }))}
                                 className="hidden"
                               />
                               <div className={cn(
                                 "w-4 h-4 rounded border flex items-center justify-center transition-all",
                                 (snapping as any)[opt.id] ? "bg-blue-600 border-blue-600" : "bg-[#1a1a1a] border-[#333] group-hover:border-[#444]"
                               )}>
                                 {(snapping as any)[opt.id] && <Check className="w-3 h-3 text-white" strokeWidth={4} />}
                               </div>
                               <span className="text-[10px] uppercase font-bold text-[#666] group-hover:text-[#888]">{opt.label}</span>
                             </label>
                           ))}
                        </div>
                      )}
                    </div>
                  </section>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="absolute right-0 top-1/2 -translate-y-12 h-24 w-1 flex items-center justify-center hover:w-2 bg-[#2a2a2a] transition-all z-[1200]"
          >
            {sidebarOpen ? <ChevronLeft className="w-3 h-3 text-[#666] -ml-2" /> : <ChevronRight className="w-3 h-3 text-[#666] -ml-2" />}
          </button>
        </motion.aside>

        {/* Viewport Area */}
        <section className="flex-1 relative bg-[#050505]">
          <MapContainer 
            center={[-12.0464, -77.0428] as LatLngExpression} 
            zoom={13} 
            zoomControl={false}
            className="w-full h-full"
            ref={setMap}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              opacity={0.8}
            />
            
            <MapEvents 
              isDrawing={isDrawing} 
              onMapClick={handleMapClick}
              onMouseMove={handleMouseMove}
            />

            {shapes.map(shape => (
              shape.visible && (shape.type === 'polygon' ? (
                <Polygon 
                  key={shape.id} 
                  positions={shape.points.map(p => [p.lat, p.lng]) as LatLngExpression[]}
                  pathOptions={{ 
                    color: selectedShapeId === shape.id ? '#fff' : shape.color, 
                    fillOpacity: selectedShapeId === shape.id ? 0.4 : 0.1,
                    weight: selectedShapeId === shape.id ? 3 : 2
                  }}
                  eventHandlers={{
                    click: (e) => {
                      L.DomEvent.stopPropagation(e);
                      setSelectedShapeId(shape.id);
                      setActiveTab('layers');
                    }
                  }}
                />
              ) : (
                <Polyline 
                  key={shape.id} 
                  positions={shape.points.map(p => [p.lat, p.lng]) as LatLngExpression[]}
                  pathOptions={{ 
                    color: selectedShapeId === shape.id ? '#fff' : shape.color, 
                    weight: selectedShapeId === shape.id ? 5 : 3 
                  }}
                  eventHandlers={{
                    click: (e) => {
                      L.DomEvent.stopPropagation(e);
                      setSelectedShapeId(shape.id);
                      setActiveTab('layers');
                    }
                  }}
                />
              ))
            ))}

            {/* Drawing State */}
            {isDrawing && currentPoints.length > 0 && (
              <Polyline 
                positions={[...currentPoints, ...(hoverPos ? [hoverPos] : [])].map(p => [p.lat, p.lng]) as LatLngExpression[]}
                pathOptions={{ color: '#3b82f6', dashArray: '8, 8', weight: 2 }}
              />
            )}
            {isDrawing && currentPoints.map((p, i) => (
              <Marker key={i} position={[p.lat, p.lng]} />
            ))}

            {/* Snapping Indicator */}
            {snappedPos && isDrawing && (
              <Marker 
                position={[snappedPos.lat, snappedPos.lng]}
                icon={L.divIcon({
                  html: `<div class="w-4 h-4 bg-emerald-500/50 border-2 border-emerald-500 rounded-full animate-ping"></div>`,
                  className: ''
                })}
              />
            )}
          </MapContainer>

          {/* Overlays */}
          <div className="absolute top-6 left-6 z-[1000] p-4 bg-[#111111]/80 backdrop-blur-md rounded-xl border border-[#2a2a2a]/60 shadow-2xl pointer-events-none flex flex-col gap-1">
             <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Cursor Activo</p>
             <p className="text-sm font-mono text-white/90 font-bold whitespace-nowrap">
               {hoverPos ? `${(hoverPos.lat ?? 0).toFixed(6)} N | ${(hoverPos.lng ?? 0).toFixed(6)} E` : 'Buscando satélite...'}
             </p>
          </div>

          <AnimatePresence>
            {isDrawing && (
              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-4 bg-[#111111] p-2 rounded-2xl border border-[#2a2a2a] shadow-2xl"
              >
                <div className="px-4 py-2 bg-[#1a1a1a] rounded-xl">
                  <span className="text-[10px] font-bold text-[#666] uppercase tracking-widest mr-3">Vértices:</span>
                  <span className="text-sm font-mono font-bold text-blue-400">{currentPoints.length}</span>
                </div>
                <button 
                  onClick={finishDrawing}
                  disabled={currentPoints.length < (drawingType === 'polygon' ? 3 : 2)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-30 disabled:grayscale transition-all shadow-lg shadow-emerald-500/20"
                >
                  Finalizar Geometría
                </button>
                <button 
                  onClick={() => { setDrawingType('none'); setCurrentPoints([]); }}
                  className="bg-[#2a2a2a] text-[#888] hover:text-white px-4 py-2.5 rounded-xl text-xs font-bold tracking-widest"
                >
                  Regresar
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="absolute top-6 right-6 z-[1000]">
             <div className="bg-[#111111]/80 backdrop-blur-md p-1 rounded-xl border border-[#2a2a2a] flex">
               <button className="px-4 py-1.5 text-[10px] font-bold bg-[#2a2a2a] text-white rounded-lg shadow-sm">SATÉLITE</button>
               <button className="px-4 py-1.5 text-[10px] font-bold text-[#666] hover:text-white rounded-lg">TERRENO</button>
             </div>
          </div>
        </section>

        {/* Data & Details Sidebar */}
        <aside className="w-80 border-l border-[#2a2a2a] bg-[#0c0c0c] flex flex-col shrink-0 overflow-hidden transform transition-all shadow-2xl">
           <div className="p-6 border-b border-[#2a2a2a]">
              <h2 className="text-[10px] font-black text-[#444] uppercase tracking-[0.2em] mb-4 flex justify-between items-center">
                Detalle de Objeto
                {selectedShape && <span className="text-blue-500 px-2 py-0.5 bg-blue-500/10 rounded-full text-[8px] tracking-widest">[Seleccionado]</span>}
              </h2>
              
              {!selectedShape ? (
                <div className="py-20 text-center opacity-30 select-none flex flex-col items-center">
                  <div className="w-12 h-12 mb-6 border border-dashed border-[#444] rounded-2xl flex items-center justify-center">
                    <Maximize2 className="w-6 h-6 text-[#222]" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#444]">Selecciona geometría para inspección</p>
                </div>
              ) : (
                <div className="space-y-6">
                   <div className="space-y-3">
                      <p className="text-[9px] font-bold text-[#666] uppercase tracking-widest text-center">Herramientas de Offset (Metros)</p>
                      <div className="flex gap-2">
                        <input 
                           type="number" 
                           placeholder="Ancho (m)" 
                           value={offsetValue}
                           onChange={(e) => setOffsetValue(parseFloat(e.target.value))}
                           className="bg-[#1a1a1a] border border-[#333] rounded-lg p-2.5 text-xs text-white focus:border-blue-500 outline-none flex-1 transition-colors"
                        />
                        {selectedShape.type === 'polygon' ? (
                          <button 
                             onClick={() => createOffset(selectedShape)}
                             className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-[10px] font-black tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
                          >
                            OFFSET
                          </button>
                        ) : (
                          <button 
                             onClick={() => createBuffer(selectedShape)}
                             className="bg-amber-600 text-white px-4 py-2.5 rounded-lg text-[10px] font-black tracking-widest hover:bg-amber-700 transition-all shadow-lg shadow-amber-600/20"
                          >
                            + FAJA
                          </button>
                        )}
                      </div>
                   </div>
                   
                   <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[#111111] p-3 rounded-xl border border-[#2a2a2a] group hover:border-[#3b82f6]/30 transition-all">
                        <p className="text-[8px] text-[#444] font-black uppercase mb-1">Área m²</p>
                        <p className="text-sm font-mono text-white font-bold">{selectedShape.area?.toLocaleString(undefined, { maximumFractionDigits: 2 }) || 'N/A'}</p>
                      </div>
                      <div className="bg-[#111111] p-3 rounded-xl border border-[#2a2a2a] group hover:border-[#3b82f6]/30 transition-all">
                        <p className="text-[8px] text-[#444] font-black uppercase mb-1">Perímetro</p>
                        <p className="text-sm font-mono text-white font-bold">{selectedShape.perimeter?.toLocaleString(undefined, { maximumFractionDigits: 2 })} m</p>
                      </div>
                   </div>
                </div>
              )}
           </div>

           {selectedShape && (
             <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-6 py-4 flex items-center justify-between border-b border-[#2a2a2a]">
                   <h3 className="text-[10px] font-black text-[#444] uppercase tracking-widest flex items-center gap-2">
                     <TableIcon className="w-3 h-3" /> Tabla de Vértices
                   </h3>
                </div>
                <div className="flex-1 overflow-auto scrollbar-hide px-3 py-2">
                   <table className="w-full text-left font-mono border-separate border-spacing-y-1">
                      <thead className="sticky top-0 bg-[#0c0c0c] z-10">
                         <tr className="text-[9px] text-[#444] font-black tracking-widest uppercase">
                            <th className="px-3 pb-3">Ref</th>
                            <th className="px-1 pb-3 text-center">X</th>
                            <th className="px-1 pb-3 text-center">Y</th>
                         </tr>
                      </thead>
                      <tbody>
                        {selectedShape.points.map((p, idx) => {
                          const utm = decimalToUtm(p);
                          return (
                            <tr key={`${selectedShape.id}-v-${idx}`} className="group">
                               <td className="px-3 py-2 text-[9px] text-blue-500 font-bold bg-[#111111] rounded-l-lg border-l border-blue-500/0 group-hover:border-blue-500 transition-all">
                                 V{idx + 1}
                               </td>
                               <td className="px-1 py-2 text-[9px] text-[#ccc] bg-[#111111] text-center tabular-nums">
                                 {(utm.easting ?? 0).toFixed(1)}
                               </td>
                               <td className="px-1 py-2 text-[9px] text-[#ccc] bg-[#111111] rounded-r-lg text-center tabular-nums">
                                 {(utm.northing ?? 0).toFixed(1)}
                               </td>
                            </tr>
                          );
                        })}
                      </tbody>
                   </table>
                </div>
             </div>
           )}

           <div className="p-6 bg-[#111111] border-t border-[#2a2a2a] space-y-3">
              <button 
                onClick={downloadKml}
                disabled={!selectedShapeId}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-30 disabled:grayscale text-white font-black rounded-xl text-[10px] uppercase tracking-[0.2em] transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" /> Exportar KML / KMZ
              </button>
              <button 
                onClick={copyCoordTable}
                disabled={!selectedShapeId}
                className="w-full py-3 bg-white hover:bg-blue-50 disabled:opacity-30 text-black font-black rounded-xl text-[10px] uppercase tracking-[0.2em] transition-all shadow-sm flex items-center justify-center gap-2"
              >
                <Clipboard className="w-4 h-4" /> Copiar Tabla
              </button>
              <button 
                onClick={() => setSelectedShapeId(null)}
                disabled={!selectedShapeId}
                className="w-full py-3 border border-[#333] text-[#666] hover:text-white hover:border-[#666] disabled:opacity-0 font-bold rounded-xl text-[10px] uppercase tracking-widest transition-all"
              >
                Deseleccionar
              </button>
           </div>
        </aside>
      </main>

      {/* Footer Status Bar */}
      <footer className="h-10 border-t border-[#2a2a2a] bg-[#111111] px-6 flex items-center justify-between shrink-0 text-[9px] font-mono tracking-[0.2em] uppercase text-[#444] z-[1200]">
        <div className="flex items-center gap-8">
           <div className="flex gap-3">
             <span className="text-[#666] flex items-center gap-2"><div className="w-1.5 h-1.5 bg-blue-600 rounded-full" /> Cursor:</span>
             <span className="text-[#ccc] tabular-nums">
               {hoverPos ? (() => {
                 const utm = decimalToUtm(hoverPos);
                 return `${(utm.easting ?? 0).toFixed(2)} E | ${(utm.northing ?? 0).toFixed(2)} N`;
               })() : 'N/A'}
             </span>
           </div>
           <div className="flex gap-3">
             <span className="text-[#666]">Sistema:</span>
             <span className="text-[#ccc]">UTM 18S / WGS84</span>
           </div>
        </div>
        
        <div className="flex items-center gap-6">
           <div className="flex gap-2">
             <span className="text-[#666]">Lat/Lon:</span>
             <span className="text-[#888] tabular-nums">
               {hoverPos ? `${(hoverPos.lat ?? 0).toFixed(5)} | ${(hoverPos.lng ?? 0).toFixed(5)}` : '0.000 | 0.000'}
             </span>
           </div>
        </div>
      </footer>
    </div>
  );
}
