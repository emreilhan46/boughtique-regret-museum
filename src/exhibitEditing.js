import {supabase} from './supabase';

// Database triggers and the editor keep this durable across interrupted requests.
export async function cleanupExhibitPhotos(userId) {
  try {
    const {data,error}=await supabase.from('exhibit_photo_cleanup').select('path').eq('user_id',userId).limit(100);
    if(error)throw error;
    if(!data?.length)return '';
    const paths=data.map(row=>row.path);
    const attached=await supabase.from('exhibits').select('photo_paths').eq('user_id',userId).overlaps('photo_paths',paths);
    if(attached.error)throw attached.error;
    const inUse=new Set((attached.data||[]).flatMap(row=>row.photo_paths));
    const detached=paths.filter(path=>!inUse.has(path));
    const confirmed=paths.filter(path=>inUse.has(path));
    if(detached.length){
      const removed=await supabase.storage.from('exhibit-photos').remove(detached);
      if(removed.error)throw removed.error;
      const removedNames=new Set((removed.data||[]).map(row=>row.name));
      for(const path of detached){
        if(removedNames.has(path)){confirmed.push(path);continue;}
        // Handles an upload that never finished or a previous successful delete
        // whose queue acknowledgement failed. Never assume a zero-row delete worked.
        const split=path.lastIndexOf('/'),folder=path.slice(0,split),name=path.slice(split+1);
        const check=await supabase.storage.from('exhibit-photos').list(folder,{search:name,limit:100});
        if(check.error)throw check.error;
        if(!(check.data||[]).some(row=>row.name===name))confirmed.push(path);
      }
    }
    if(confirmed.length){
      const result=await supabase.from('exhibit_photo_cleanup').delete().eq('user_id',userId).in('path',confirmed);
      if(result.error)throw result.error;
    }
    if(confirmed.length!==paths.length||data.length===100)return 'Some photo removals are still pending. Use Retry photo cleanup in Your account.';
    return '';
  }catch{
    return 'Photo cleanup is pending. Use Retry photo cleanup in Your account.';
  }
}

export function matchingVersion(query,item) {
  return item.edited_at ? query.eq('edited_at',item.edited_at) : query.is('edited_at',null);
}
