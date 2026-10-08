import { createClient } from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured=Boolean(url&&key);
export const supabase=configured?createClient(url,key):null;
export const categories=['Impulse buy','Expensive mistake','Never used','Influenced & regretted','Luxury regret','Tech disappointment','Home & furniture','Car & transport','Other'];
export const money=(amount,currency='EUR')=>amount==null?'Price not shared':new Intl.NumberFormat('en',{style:'currency',currency,maximumFractionDigits:0}).format(amount);
export function imageUrl(path){if(!path||!supabase)return null;return supabase.storage.from('exhibit-photos').getPublicUrl(path).data.publicUrl;}
