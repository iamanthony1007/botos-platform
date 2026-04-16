import { createContext, useContext, useState, useCallback } from 'react'

const DataCacheContext = createContext({})

export function DataCacheProvider({ children }) {
  const [cache, setCache] = useState({})

  const get = useCallback((key) => cache[key] || null, [cache])

  const set = useCallback((key, value) => {
    setCache(prev => ({ ...prev, [key]: { data: value, ts: Date.now() } }))
  }, [])

  const isFresh = useCallback((key, maxAgeMs = 30000) => {
    const entry = cache[key]
    if (!entry) return false
    return (Date.now() - entry.ts) < maxAgeMs
  }, [cache])

  return (
    <DataCacheContext.Provider value={{ get, set, isFresh }}>
      {children}
    </DataCacheContext.Provider>
  )
}

export function useDataCache() {
  return useContext(DataCacheContext)
}
