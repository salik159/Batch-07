import { useEffect,useState } from 'react';
import type { NewsItem } from '../types';
import { getNews } from '../../../services/api';
const INITIAL:NewsItem[]=[{tag:'SYSTEM',title:'Waiting for live news feed…'},{tag:'SYSTEM',title:'Configure NEWS_API_KEY in .env for live headlines.'}];
export function useNewsFeed(intervalMs=360000){const [items,setItems]=useState(INITIAL);useEffect(()=>{let alive=true;const refresh=()=>getNews().then(v=>{if(alive&&v.length)setItems(v)}).catch(()=>{});refresh();const id=window.setInterval(refresh,intervalMs);return()=>{alive=false;window.clearInterval(id)}},[intervalMs]);return items;}
