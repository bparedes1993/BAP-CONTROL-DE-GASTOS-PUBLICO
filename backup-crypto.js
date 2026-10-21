/* Passwords stay in memory; only encrypted envelopes are downloaded. */
(() => {
  const FORMAT='bap-encrypted-v1', iterations=600000;
  const encode=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
  const decode=s=>{if(typeof s!=='string'||s.length>42000000||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw Error('Respaldo inválido');return Uint8Array.from(atob(s),c=>c.charCodeAt(0));};
  async function key(password,salt,usage){
    const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,[usage]);
  }
  async function encrypt(data,password){
    if(typeof password!=='string'||password.length<12)throw Error('Usa una contraseña de al menos 12 caracteres.');
    const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(FORMAT)},await key(password,salt,'encrypt'),new TextEncoder().encode(JSON.stringify(data)));
    return {format:FORMAT,kdf:'PBKDF2-SHA256',iterations,salt:encode(salt),iv:encode(iv),ciphertext:encode(new Uint8Array(ciphertext))};
  }
  async function decrypt(data,password){
    if(data.format!==FORMAT||data.kdf!=='PBKDF2-SHA256'||data.iterations!==iterations)throw Error('Formato de cifrado no compatible');
    const salt=decode(data.salt),iv=decode(data.iv),ciphertext=decode(data.ciphertext);
    if(salt.length!==16||iv.length!==12||ciphertext.length<16)throw Error('Respaldo inválido');
    try{return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(FORMAT)},await key(password,salt,'decrypt'),ciphertext)));}
    catch{throw Error('Contraseña incorrecta o respaldo dañado. No se modificaron los datos.');}
  }
  let busy=false;
  async function password(confirmPassword){
    if(busy)throw Error('Ya hay un respaldo abierto.');busy=true;
    const dialog=document.createElement('dialog');dialog.className='backup-password';
    dialog.innerHTML='<form><h2>Respaldo protegido</h2><p>Guarda esta contraseña en un lugar seguro. Sin ella no podrás recuperar la copia. No se envía al servidor.</p><label>Contraseña (mínimo 12 caracteres)<input name="password" type="password" autocomplete="new-password" minlength="12" required></label>'+(confirmPassword?'<label>Repite la contraseña<input name="repeat" type="password" autocomplete="new-password" required></label>':'')+'<p role="alert"></p><button type="submit">Continuar</button> <button type="button" data-cancel>Cancelar</button></form>';
    document.body.append(dialog);
    try{return await new Promise((resolve,reject)=>{
      const cancel=()=>reject(Error('Operación cancelada.'));
      dialog.addEventListener('cancel',e=>{e.preventDefault();cancel();});
      dialog.querySelector('[data-cancel]').onclick=cancel;
      dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const p=dialog.querySelector('[name=password]').value;if(confirmPassword&&p!==dialog.querySelector('[name=repeat]').value){dialog.querySelector('[role=alert]').textContent='Las contraseñas no coinciden.';return;}resolve(p);};
      dialog.showModal();dialog.querySelector('input').focus();
    });}finally{dialog.remove();busy=false;}
  }
  window.BAP_BACKUP=Object.freeze({encrypt,decrypt,
    async seal(data){return encrypt(data,await password(true));},
    async open(text){const data=JSON.parse(text);return data?.format===FORMAT?decrypt(data,await password(false)):data;}
  });
})();
