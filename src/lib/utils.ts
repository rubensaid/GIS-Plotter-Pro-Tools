import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import UtmConverter from "utm-latlng"
import * as turf from "@turf/turf"
import { Point, UTMCoordinate, GeoShape } from "../types"
import JSZip from 'jszip'
import * as toGeoJSON from '@tmcw/togeojson'
import tokml from 'tokml'

const utmObj = new (UtmConverter as any)()

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function utmToDecimal(utm: UTMCoordinate): Point {
  const result = utmObj.convertUtmToLatLng(utm.easting, utm.northing, utm.zoneNum, utm.zoneLetter)
  if (typeof result === 'string') {
    console.error("UTM to Decimal Error:", result)
    return { lat: 0, lng: 0 }
  }
  return { lat: result.lat ?? 0, lng: result.lng ?? 0 }
}

export function decimalToUtm(point: Point): UTMCoordinate {
  // Library expects (lat, lng, precision)
  // If precision is not provided, it might return NaN or error
  const result = utmObj.convertLatLngToUtm(point.lat, point.lng, 10)
  
  if (typeof result === 'string') {
    console.error("UTM Conversion Error:", result)
    return { easting: 0, northing: 0, zoneNum: 0, zoneLetter: '' }
  }

  return {
    easting: result.Easting ?? 0,
    northing: result.Northing ?? 0,
    zoneNum: result.ZoneNumber ?? 0,
    zoneLetter: result.ZoneLetter ?? ''
  }
}

export function calculateArea(points: Point[]): number {
  if (points.length < 3) return 0
  const coords = [...points, points[0]].map(p => [p.lng, p.lat])
  const polygon = turf.polygon([coords])
  return turf.area(polygon)
}

export function calculatePerimeter(points: Point[], isPolygon: boolean): number {
  if (points.length < 2) return 0
  const coords = points.map(p => [p.lng, p.lat])
  if (isPolygon) {
    const polygon = turf.polygon([[...coords, coords[0]]])
    return turf.length(polygon, { units: 'meters' })
  } else {
    const line = turf.lineString(coords)
    return turf.length(line, { units: 'meters' })
  }
}

export function createOffsetPolygon(points: Point[], offsetMeters: number): Point[] {
  if (points.length < 3) return []
  const coords = [...points, points[0]].map(p => [p.lng, p.lat])
  const polygon = turf.polygon([coords])
  const buffered = turf.buffer(polygon, offsetMeters, { units: 'meters' })
  
  if (buffered.geometry.type === 'Polygon') {
    return buffered.geometry.coordinates[0].map(coord => ({ lat: coord[1], lng: coord[0] }))
  } else if (buffered.geometry.type === 'MultiPolygon') {
    // Return the first polygon for simplicity
    return buffered.geometry.coordinates[0][0].map(coord => ({ lat: coord[1], lng: coord[0] }))
  }
  return []
}

export function findNearbyPoint(
  target: Point,
  shapes: GeoShape[],
  thresholdMeters: number,
  settings: any
): Point | null {
  let closest: Point | null = null
  let minDistance = thresholdMeters

  const updateClosest = (p: Point) => {
    const dist = turf.distance([target.lng, target.lat], [p.lng, p.lat], { units: 'meters' })
    if (dist < minDistance) {
      minDistance = dist
      closest = p
    }
  }

  shapes.forEach(shape => {
    if (!shape.visible) return
    const points = shape.points
    
    if (settings.endpoints) {
      points.forEach((p: Point) => updateClosest(p))
    }

    if (settings.midpoints) {
      for (let i = 0; i < points.length; i++) {
        const p1 = points[i]
        const p2 = points[(i + 1) % points.length]
        const mid = turf.midpoint([p1.lng, p1.lat], [p2.lng, p2.lat])
        updateClosest({ lat: mid.geometry.coordinates[1], lng: mid.geometry.coordinates[0] })
      }
    }

    if (settings.centers && shape.type === 'polygon') {
      const coords = [...points, points[0]].map(p => [p.lng, p.lat])
      const polygon = turf.polygon([coords])
      const center = turf.center(polygon)
      updateClosest({ lat: center.geometry.coordinates[1], lng: center.geometry.coordinates[0] })
    }
  })

  if (settings.intersections && shapes.length > 1) {
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const s1 = shapes[i]
        const s2 = shapes[j]
        if (!s1.visible || !s2.visible) continue

        const line1 = turf.lineString(s1.type === 'polygon' ? [...s1.points, s1.points[0]].map(p => [p.lng, p.lat]) : s1.points.map(p => [p.lng, p.lat]))
        const line2 = turf.lineString(s2.type === 'polygon' ? [...s2.points, s2.points[0]].map(p => [p.lng, p.lat]) : s2.points.map(p => [p.lng, p.lat]))
        
        const inter = turf.lineIntersect(line1, line2)
        inter.features.forEach(feat => {
          updateClosest({ lat: feat.geometry.coordinates[1], lng: feat.geometry.coordinates[0] })
        })
      }
    }
  }

  return closest
}

export async function parseKml(file: File): Promise<GeoShape[]> {
  const isKmz = file.name.endsWith('.kmz')
  let kmlText = ''

  if (isKmz) {
    const zip = await JSZip.loadAsync(file)
    const kmlFile = Object.values(zip.files).find(f => f.name.endsWith('.kml'))
    if (!kmlFile) throw new Error('No KML file found in KMZ')
    kmlText = await kmlFile.async('string')
  } else {
    kmlText = await file.text()
  }

  const parser = new DOMParser()
  const kmlDom = parser.parseFromString(kmlText, 'text/xml')
  const geojson = toGeoJSON.kml(kmlDom) as any

  const shapes: GeoShape[] = []

  geojson.features.forEach((feature: any) => {
    const type = feature.geometry.type
    const coords = feature.geometry.coordinates
    const name = feature.properties?.name || `Capar Importada ${shapes.length + 1}`

    if (type === 'Polygon' || type === 'LineString') {
      const points: Point[] = (type === 'Polygon' ? coords[0] : coords).map((c: any) => ({
        lat: c[1],
        lng: c[0]
      }))

      shapes.push({
        id: Math.random().toString(36).substr(2, 9),
        type: type === 'Polygon' ? 'polygon' : 'polyline',
        points,
        name,
        color: `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`,
        visible: true,
        area: type === 'Polygon' ? calculateArea(points) : 0,
        perimeter: calculatePerimeter(points, type === 'Polygon')
      })
    } else if (type === 'MultiPolygon' || type === 'MultiLineString') {
        // Simple extraction of first part
        const subCoords = type === 'MultiPolygon' ? coords[0][0] : coords[0]
        const points: Point[] = subCoords.map((c: any) => ({
          lat: c[1],
          lng: c[0]
        }))
        shapes.push({
          id: Math.random().toString(36).substr(2, 9),
          type: type === 'MultiPolygon' ? 'polygon' : 'polyline',
          points,
          name,
          color: `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`,
          visible: true,
          area: type === 'MultiPolygon' ? calculateArea(points) : 0,
          perimeter: calculatePerimeter(points, type === 'MultiPolygon')
        })
    }
  })

  return shapes
}

export function generateBufferFromLine(points: Point[], distanceMeters: number): Point[] {
  if (points.length < 2) return []
  const coords = points.map(p => [p.lng, p.lat])
  const line = turf.lineString(coords)
  const buffered = turf.buffer(line, distanceMeters, { units: 'meters' })
  
  if (buffered.geometry.type === 'Polygon') {
    return buffered.geometry.coordinates[0].map(coord => ({ lat: coord[1], lng: coord[0] }))
  } else if (buffered.geometry.type === 'MultiPolygon') {
    return buffered.geometry.coordinates[0][0].map(coord => ({ lat: coord[1], lng: coord[0] }))
  }
  return []
}

export function exportToKml(shapes: GeoShape[]): string {
  const features = shapes.map(shape => {
    const coords = shape.points.map(p => [p.lng, p.lat])
    if (shape.type === 'polygon') {
      const closedCoords = [...coords, coords[0]]
      return turf.polygon([closedCoords], { name: shape.name, color: shape.color })
    }
    return turf.lineString(coords, { name: shape.name, color: shape.color })
  })
  
  const collection = turf.featureCollection(features as any)
  return tokml(collection)
}

export function exportToCoordinateTable(shapes: GeoShape[]): string {
  let table = "Capa\tVértice\tLatitud\tLongitud\tEste\tNorte\tZona\tLetra\n"
  shapes.forEach(shape => {
    shape.points.forEach((p, idx) => {
      const utm = decimalToUtm(p)
      table += `${shape.name}\tV${idx + 1}\t${p.lat.toFixed(6)}\t${p.lng.toFixed(6)}\t${(utm.easting ?? 0).toFixed(2)}\t${(utm.northing ?? 0).toFixed(2)}\t${utm.zoneNum}\t${utm.zoneLetter}\n`
    })
  })
  return table
}

export function getShapeBounds(shape: GeoShape): L.LatLngBoundsExpression | null {
  if (shape.points.length === 0) return null
  const coords = shape.points.map(p => [p.lng, p.lat])
  const line = turf.lineString(coords)
  const bbox = turf.bbox(line) // [minX, minY, maxX, maxY] -> [minLng, minLat, maxLng, maxLat]
  return [
    [bbox[1], bbox[0]],
    [bbox[3], bbox[2]]
  ] as L.LatLngBoundsExpression
}
