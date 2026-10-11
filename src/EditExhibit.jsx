import React,{useEffect,useState} from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {ArrowLeft,ImagePlus} from 'lucide-react';
import {supabase,categories,imageUrl} from './supabase';
import {cleanupExhibitPhotos,matchingVersion} from './exhibitEditing';

function Photo({photo,index,count,move,remove}) {
  const [preview,setPreview]=useState('');
  useEffect(()=>{
    if(!photo.file){setPreview(imageUrl(photo.path));return;}
    const url=URL.createObjectURL(photo.file);setPreview(url);
    return()=>URL.revokeObjectURL(url);
  },[photo]);
  return <div className="edit-photo">
    <img src={preview} alt={`Exhibit photo ${index+1}`}/>
    <span>{index===0?'Cover photo':`Photo ${index+1}`}</span>
    <div className="photo-actions">
      <button type="button" aria-label={`Move photo ${index+1} earlier`} disabled={index===0} onClick={()=>move(index,-1)}>←</button>
      <button type="button" aria-label={`Move photo ${index+1} later`} disabled={index===count-1} onClick={()=>move(index,1)}>→</button>
      <button type="button" aria-label={`Remove photo ${index+1}`} onClick={()=>remove(index)}>Remove</button>
    </div>
  </div>;
}

export default function EditExhibit({session,ready}) {
  const {id}=useParams();const nav=useNavigate();
  const [item,setItem]=useState(null),[form,setForm]=useState(null),[photos,setPhotos]=useState([]);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
  useEffect(()=>{
    let active=true;setItem(null);setForm(null);setLoading(true);setError('');
    if(!ready)return;
    if(!session||!supabase){setLoading(false);return;}
    supabase.from('exhibits').select('*').eq('id',id).eq('user_id',session.user.id).maybeSingle().then(({data,error})=>{
      if(!active)return;
      setError(error?.message||'');setItem(data);
      if(data){
        setForm({title:data.title,story:data.story,lesson:data.lesson||'',category:data.category,
          original_price:data.original_price??'',currency:data.currency,
          sale:data.for_sale?'available':data.sold_at?'sold':'none',asking_price:data.asking_price??'',
          item_condition:data.item_condition||'good',location:data.location||'',status:data.status});
        setPhotos(data.photo_paths.map(path=>({key:path,path})));setDirty(false);
      }
      setLoading(false);
    }).catch(err=>{if(active){setError(err.message);setLoading(false);}});
    return()=>{active=false;};
  },[id,session?.user.id,ready]);
  useEffect(()=>{
    if(!dirty&&!busy)return;
    const warn=e=>{e.preventDefault();e.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[dirty,busy]);
  const change=(key,value)=>{setForm(old=>({...old,[key]:value}));setDirty(true);};
  function addFiles(files){
    const added=Array.from(files);setError('');
    if(photos.length+added.length>6){setError('You can have up to 6 photos.');return;}
    if(added.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>5*1024*1024)){
      setError('Use JPG, PNG or WebP photos up to 5 MB each.');return;
    }
    setPhotos(old=>[...old,...added.map(file=>({key:crypto.randomUUID(),file}))]);setDirty(true);
  }
  function move(index,delta){
    setPhotos(old=>{const next=[...old];[next[index],next[index+delta]]=[next[index+delta],next[index]];return next;});setDirty(true);
  }
  function cancel(e){if(busy||(dirty&&!window.confirm('Discard your unsaved changes?')))e.preventDefault();}
  async function save(e){
    e.preventDefault();if(busy)return;
    if(form.title.trim().length<3||form.story.trim().length<20){setError('Use at least 3 characters for the title and 20 for the story.');return;}
    if(form.sale==='available'&&(!photos.length||Number(form.asking_price)<=0||!form.location.trim())){
      setError('For sale: add a photo, a positive asking price and a pickup area.');return;
    }
    setBusy(true);setError('');
    try{
      const paths=[];
      for(const photo of photos){
        if(photo.path){paths.push(photo.path);continue;}
        const ext=photo.file.type==='image/png'?'png':photo.file.type==='image/webp'?'webp':'jpg';
        const path=`${session.user.id}/${id}/${crypto.randomUUID()}.${ext}`;
        const queued=await supabase.from('exhibit_photo_cleanup').insert({path,user_id:session.user.id});
        if(queued.error)throw queued.error;
        const result=await supabase.storage.from('exhibit-photos').upload(path,photo.file,{contentType:photo.file.type,upsert:false});
        if(result.error)throw result.error;
        // Keep uploaded paths in the draft so retrying after a failed save reuses them.
        // Never remove uploads after an ambiguous network failure: the save may have committed.
        photo.path=path;paths.push(path);
      }
      const payload={title:form.title.trim(),story:form.story.trim(),lesson:form.lesson.trim()||null,
        category:form.category,original_price:form.original_price===''?null:Number(form.original_price),currency:form.currency,
        for_sale:form.sale==='available',sold_at:form.sale==='sold'?(item.sold_at||new Date().toISOString()):null,
        asking_price:form.asking_price===''?null:Number(form.asking_price),item_condition:form.item_condition,
        location:form.location.trim()||null,status:form.status,photo_paths:paths};
      const {data,error}=await matchingVersion(supabase.from('exhibits').update(payload).eq('id',id).eq('user_id',session.user.id),item).select('id').maybeSingle();
      if(error)throw error;
      if(!data)throw new Error('This exhibit changed in another tab or is no longer available. Reload before editing again.');
      setDirty(false);
      const warning=await cleanupExhibitPhotos(session.user.id);
      nav('/account',{state:{notice:'Exhibit updated.'+(warning?' '+warning:'')}});
    }catch(err){setError(err.message||'Unable to save. Please try again.');}
    finally{setBusy(false);}
  }
  async function remove(){
    if(busy||!window.confirm('Permanently delete this exhibit? Its comments, likes, reports and buyer–seller conversations will also be deleted. This cannot be undone.'))return;
    setBusy(true);setError('');
    try{
      const {data,error}=await matchingVersion(supabase.from('exhibits').delete().eq('id',id).eq('user_id',session.user.id),item).select('id').maybeSingle();
      if(error)throw error;
      if(!data)throw new Error('This exhibit changed or is no longer available. Reload before deleting.');
      setDirty(false);
      const warning=await cleanupExhibitPhotos(session.user.id);
      nav('/account',{state:{notice:'Exhibit permanently deleted.'+(warning?' '+warning:'')}});
    }catch(err){setError(err.message||'Unable to delete. Please try again.');}
    finally{setBusy(false);}
  }
  if(!ready||loading)return <div className="shell pad">Loading your exhibit...</div>;
  if(!session)return <div className="shell narrow pad"><h1>Edit your exhibit</h1><p>Sign in with the account that published it.</p><Link className="button dark" to="/login">Sign in</Link></div>;
  if(!item||!form)return <div className="shell narrow pad"><h1>Exhibit unavailable</h1><p>{error||'You can only edit your own exhibits.'}</p><Link to="/account">Back to Your account</Link></div>;
  return <div className="shell narrow pad">
    <Link className="back" to="/account" onClick={cancel}><ArrowLeft size={16}/> Your account</Link>
    <div className="eyebrow dark-text">YOUR EXHIBIT</div><h1>Edit your exhibit.</h1>
    <p className="muted">Published {new Date(item.created_at).toLocaleDateString()}. Saving keeps this date and adds an Edited label.</p>
    <form className="panel form" onSubmit={save}>
      <fieldset className="edit-fieldset" disabled={busy}>
        <section className="form-section"><h2>Photos</h2><p className="muted">Up to 6 photos · JPG, PNG, WebP · 5 MB each. The first photo is your cover.</p>
          <div className="edit-photo-grid">{photos.map((photo,index)=><Photo key={photo.key} photo={photo} index={index} count={photos.length} move={move} remove={i=>{setPhotos(old=>old.filter((_,n)=>n!==i));setDirty(true);}}/>)}
            {photos.length<6&&<label className="upload-add"><ImagePlus/><span>Add photos</span><input aria-label="Add photos" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{addFiles(e.target.files);e.target.value='';}}/></label>}
          </div>
        </section>
        <section className="form-section"><h2>Your confession</h2>
          <label>Title<input required minLength={3} maxLength={130} value={form.title} onChange={e=>change('title',e.target.value)}/></label>
          <div className="two"><label>BOUGHT AT<input type="number" min="0" max="999999999" step="0.01" value={form.original_price} onChange={e=>change('original_price',e.target.value)}/></label>
          <label>Currency<select value={form.currency} onChange={e=>change('currency',e.target.value)}>{['EUR','USD','GBP','CHF','CAD','AUD'].map(c=><option key={c}>{c}</option>)}</select></label></div>
          <label>Category<select value={form.category} onChange={e=>change('category',e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
          <label>Story<textarea required minLength={20} maxLength={2500} rows={6} value={form.story} onChange={e=>change('story',e.target.value)}/></label>
          <label>Lesson learned <span className="optional">Optional</span><input maxLength={250} value={form.lesson} onChange={e=>change('lesson',e.target.value)}/></label>
        </section>
        <section className="form-section"><h2>Sale details</h2>
          <label>Sale status<select value={form.sale} onChange={e=>change('sale',e.target.value)}><option value="none">Not for sale / withdraw from sale</option><option value="available">Available for sale</option><option value="sold">Sold</option></select></label>
          {form.sale==='available'&&<><div className="two"><label>NOW ASKING<input required type="number" min="0.01" max="999999999" step="0.01" value={form.asking_price} onChange={e=>change('asking_price',e.target.value)}/></label>
          <label>Condition<select value={form.item_condition} onChange={e=>change('item_condition',e.target.value)}><option value="new">Like new</option><option value="good">Good</option><option value="fair">Fair</option><option value="parts">For parts</option></select></label></div>
          <label>General pickup area<input required maxLength={100} value={form.location} onChange={e=>change('location',e.target.value)}/></label></>}
        </section>
        <section className="form-section"><h2>Visibility</h2>
          <label>Who can see this exhibit?<select value={form.status} onChange={e=>change('status',e.target.value)}><option value="published">Published in the museum</option><option value="hidden">Hidden from the museum</option></select></label>
          <p className="muted tiny">Hidden exhibits are available to you through Your account. Previously shared photo links may still work because photos use public storage.</p>
        </section>
        <div className="edit-actions"><button className="button primary" type="submit">{busy?'Saving...':'Save changes'}</button><Link className="button ghost bordered" to="/account" onClick={cancel}>Cancel</Link></div>
      </fieldset>
      {error&&<p className="notice error" role="alert">{error}</p>}
    </form>
    <section className="delete-panel"><h2>Permanently delete</h2><p>This removes the exhibit and its related comments, likes, reports and conversations. Photo removal will be attempted immediately and retried from Your account if needed.</p><button className="button danger" type="button" disabled={busy} onClick={remove}>Delete exhibit permanently</button></section>
  </div>;
}
