
document.getElementById('yr').textContent=new Date().getFullYear();
const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouch=window.matchMedia('(hover:none)').matches;

/* ============ WEBGL FLUID BACKGROUND ============ */
(function(){
  if(!window.THREE) return;
  const canvas=document.getElementById('bg-canvas');
  let renderer;
  try{ renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:true}); }catch(e){ canvas.style.display='none'; return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.6));
  const scene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const uniforms={
    uTime:{value:0},
    uRes:{value:new THREE.Vector2(1,1)},
    uMouse:{value:new THREE.Vector2(.5,.5)},
    uScroll:{value:0}
  };
  const frag=`
    precision highp float;
    uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; uniform float uScroll;
    varying vec2 vUv;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
    float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<6;i++){v+=a*noise(p);p*=2.02;a*=.5;}return v;}
    void main(){
      vec2 uv=vUv;
      vec2 p=uv; p.x*=uRes.x/uRes.y;
      float t=uTime*.045;
      vec2 q=vec2(fbm(p*2.4+t),fbm(p*2.4-t+5.0));
      vec2 r=vec2(fbm(p*2.4+q*1.6+t*1.3),fbm(p*2.4+q*1.6-t));
      float f=fbm(p*2.2+r*1.4+uScroll*.6);
      float caustic=pow(abs(sin((r.x+r.y)*3.14159 + uTime*.25)),3.0);
      vec3 deep=vec3(0.015,0.03,0.08);
      vec3 mid=vec3(0.05,0.16,0.42);
      vec3 hi=vec3(0.28,0.62,1.0);
      vec3 col=mix(deep,mid,smoothstep(.1,.9,f));
      col+=hi*caustic*.5*smoothstep(.2,1.0,f);
      // mouse light
      float md=distance(uv,uMouse);
      col+=hi*.10*smoothstep(.45,0.,md);
      // top glow
      col+=vec3(0.06,0.16,0.4)*smoothstep(.9,0.,uv.y)*.5;
      // vignette
      float vg=smoothstep(1.25,.25,distance(uv,vec2(.5)));
      col*=vg;
      gl_FragColor=vec4(col,1.0);
    }`;
  const vert=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}`;
  const mat=new THREE.ShaderMaterial({uniforms,vertexShader:vert,fragmentShader:frag});
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),mat));
  function resize(){const w=window.innerWidth,h=window.innerHeight;renderer.setSize(w,h,false);uniforms.uRes.value.set(w,h);}
  window.addEventListener('resize',resize);resize();
  let mx=.5,my=.5,cmx=.5,cmy=.5;
  window.addEventListener('pointermove',e=>{mx=e.clientX/window.innerWidth;my=1-e.clientY/window.innerHeight;});
  const clock=new THREE.Clock();
  let visible=true;
  document.addEventListener('visibilitychange',()=>visible=!document.hidden);
  function loop(){
    requestAnimationFrame(loop);
    if(!visible) return;
    cmx+=(mx-cmx)*.05;cmy+=(my-cmy)*.05;
    uniforms.uMouse.value.set(cmx,cmy);
    uniforms.uTime.value=clock.getElapsedTime();
    uniforms.uScroll.value=(window.scrollY||0)/1200;
    renderer.render(scene,camera);
  }
  loop();
})();

/* ============ PRELOADER ============ */
(function(){
  const loader=document.getElementById('loader');
  const bar=loader.querySelector('.bar');
  const fill=loader.querySelector('.fill');
  const pctn=document.getElementById('pctn');
  let p=0;
  const tick=setInterval(()=>{
    p+=Math.random()*16+6; if(p>100)p=100;
    bar.style.width=p+'%'; fill.style.height=p+'%'; pctn.textContent=Math.floor(p);
    if(p>=100){clearInterval(tick); setTimeout(done,350);}
  },140);
  function done(){
    gsap.to(loader,{yPercent:-100,duration:1.1,ease:'expo.inOut',onComplete:()=>{loader.style.display='none';}});
    document.body.classList.remove('lock');
    startIntro();
  }
})();

/* ============ LENIS SMOOTH SCROLL ============ */
let lenis;
if(!reduce && typeof Lenis!=='undefined'){
  try{
    lenis=new Lenis({lerp:.09,wheelMultiplier:1});
    lenis.on('scroll',()=>ScrollTrigger.update());
    gsap.ticker.add(t=>lenis.raf(t*1000));
    gsap.ticker.lagSmoothing(0);
  }catch(e){lenis=null;}
}
document.querySelectorAll('a[href^="#"]').forEach(a=>{
  a.addEventListener('click',e=>{
    const id=a.getAttribute('href');
    if(id.length>1){const el=document.querySelector(id);if(el){e.preventDefault();lenis?lenis.scrollTo(el,{offset:-10}):el.scrollIntoView({behavior:'smooth'});}}
  });
});
gsap.registerPlugin(ScrollTrigger);

/* ============ CUSTOM CURSOR ============ */
if(!isTouch){
  const dot=document.querySelector('.cur-dot'), ring=document.querySelector('.cur-ring');
  let x=innerWidth/2,y=innerHeight/2,rx=x,ry=y;
  window.addEventListener('pointermove',e=>{x=e.clientX;y=e.clientY;dot.style.transform=`translate(${x}px,${y}px) translate(-50%,-50%)`;});
  (function r(){rx+=(x-rx)*.18;ry+=(y-ry)*.18;ring.style.transform=`translate(${rx}px,${ry}px) translate(-50%,-50%)`;requestAnimationFrame(r);})();
  document.querySelectorAll('[data-hover],a,button').forEach(el=>{
    el.addEventListener('mouseenter',()=>ring.classList.add('hover'));
    el.addEventListener('mouseleave',()=>ring.classList.remove('hover'));
  });
  document.addEventListener('mouseleave',()=>ring.classList.add('hidden'));
  document.addEventListener('mouseenter',()=>ring.classList.remove('hidden'));
}

/* ============ SPLIT TEXT (words) helper ============ */
function splitWords(el){
  const text=el.textContent;el.textContent='';
  text.split(/(\s+)/).forEach(w=>{
    if(w.trim()===''){el.appendChild(document.createTextNode(w));return;}
    const span=document.createElement('span');span.className='word';span.textContent=w;el.appendChild(span);
  });
  return el.querySelectorAll('.word');
}

/* ============ INTRO ANIMATION ============ */
function startIntro(){
  const tl=gsap.timeline({defaults:{ease:'expo.out'}});
  gsap.set('.hero-h1 .line',{yPercent:110});
  tl.to('.hero-h1 .line',{yPercent:0,duration:1.2,stagger:.09},0)
    .from('#hero .eyebrow',{y:20,opacity:0,duration:.8},.2)
    .from('.hero-sub',{y:24,opacity:0,duration:.9},'-=.7')
    .from('.hero-actions .btn',{y:20,opacity:0,duration:.7,stagger:.1},'-=.6')
    .from('.hero-meta .m',{y:24,opacity:0,duration:.7,stagger:.1},'-=.6')
    .from('#stage',{opacity:0,scale:.9,duration:1.4,ease:'expo.out'},.1)
    .from('.hero-tag',{opacity:0,x:(i)=>i%2?30:-30,duration:.8,stagger:.12},'-=.9')
    .from('.scrollcue',{opacity:0,duration:.6},'-=.4');
  countUp();
}

/* ============ SCROLL REVEALS ============ */
function initReveals(){
  // generic reveal for elements with .reveal (not hero handled)
  gsap.utils.toArray('.reveal').forEach(el=>{
    if(el.closest('#hero')) return;
    gsap.from(el,{
      y:40,opacity:0,duration:1,ease:'expo.out',
      scrollTrigger:{trigger:el,start:'top 88%'}
    });
  });
  // section headings word stagger
  gsap.utils.toArray('.sec-head h2, #final h2 .line, .panel-intro h2').forEach(h=>{
    if(h.closest('#final')) return;
  });
  // final lines
  gsap.set('#final .line',{yPercent:110});
  gsap.to('#final .line',{yPercent:0,duration:1.2,ease:'expo.out',stagger:.1,scrollTrigger:{trigger:'#final',start:'top 75%'}});
}

/* ============ COUNTERS ============ */
function countUp(){
  document.querySelectorAll('[data-count]').forEach(el=>{
    const target=+el.dataset.count, suf=el.dataset.suffix||'';
    ScrollTrigger.create({
      trigger:el,start:'top 90%',once:true,
      onEnter:()=>{
        const o={v:0};
        gsap.to(o,{v:target,duration:1.6,ease:'power2.out',onUpdate:()=>{el.textContent=Math.round(o.v)+suf;}});
      }
    });
  });
}

/* ============ HORIZONTAL SCROLL (problem) ============ */
function initHorizontal(){
  const track=document.getElementById('htrack');
  const section=document.getElementById('problem');
  if(!track) return;
  const scrollDist=()=>track.scrollWidth-window.innerWidth+ (window.innerWidth*0.05);
  gsap.to(track,{
    x:()=>-scrollDist(),
    ease:'none',
    scrollTrigger:{
      trigger:section,start:'top top',end:()=>'+='+scrollDist(),
      pin:true,scrub:1,invalidateOnRefresh:true,anticipatePin:1
    }
  });
}

/* ============ MARQUEE ============ */
function initMarquee(){
  const track=document.getElementById('marquee');
  if(!track) return;
  const tween=gsap.to(track,{xPercent:-50,repeat:-1,duration:24,ease:'none'});
  let last=window.scrollY;
  window.addEventListener('scroll',()=>{
    const now=window.scrollY;
    gsap.to(tween,{timeScale:now>last?2.2:.8,duration:.5,onComplete:()=>gsap.to(tween,{timeScale:1,duration:1})});
    last=now;
  },{passive:true});
}

/* ============ PRODUCT 3D TILT + PARALLAX ============ */
(function(){
  const stage=document.getElementById('stage');
  const img=document.getElementById('productImg');
  const ring=document.getElementById('spinRing');
  if(!stage) return;
  let tx=0,ty=0,cx=0,cy=0;
  if(!isTouch){
    window.addEventListener('pointermove',e=>{
      tx=(e.clientX/innerWidth-.5);ty=(e.clientY/innerHeight-.5);
    });
  }
  // idle float
  gsap.to(img,{y:'+=18',duration:3.4,ease:'sine.inOut',yoyo:true,repeat:-1});
  gsap.to(ring,{rotation:360,duration:60,ease:'none',repeat:-1});
  (function r(){
    cx+=(tx-cx)*.06;cy+=(ty-cy)*.06;
    img.style.transform=`rotateY(${cx*16}deg) rotateX(${-cy*12}deg) translateZ(30px)`;
    stage.style.transform=`translate(${cx*18}px,${cy*14}px)`;
    requestAnimationFrame(r);
  })();
  // scroll parallax on product
  gsap.to('.hero-visual',{yPercent:-12,ease:'none',scrollTrigger:{trigger:'#hero',start:'top top',end:'bottom top',scrub:true}});
  // floating tags parallax
  gsap.utils.toArray('[data-float]').forEach(t=>{
    const s=parseFloat(t.dataset.float);
    gsap.to(t,{y:20*s,duration:2.6+Math.abs(s),ease:'sine.inOut',yoyo:true,repeat:-1});
  });
})();

/* ============ TECH ORB MOLECULES ============ */
(function(){
  const v=document.getElementById('techVisual');
  if(!v) return;
  // orbit rings that rotate slowly, each carrying molecules
  for(let ringN=0;ringN<3;ringN++){
    const orbit=document.createElement('div');
    orbit.style.cssText='position:absolute;left:50%;top:50%;width:0;height:0';
    v.appendChild(orbit);
    const rad=120+ringN*70, count=4+ringN*2;
    for(let i=0;i<count;i++){
      const m=document.createElement('div');m.className='molecule';
      const ang=(i/count)*Math.PI*2;
      gsap.set(m,{x:Math.cos(ang)*rad,y:Math.sin(ang)*rad,scale:.55+Math.random()*.6});
      orbit.appendChild(m);
      gsap.to(m,{scale:'+=.35',duration:2+Math.random()*2,yoyo:true,repeat:-1,ease:'sine.inOut'});
    }
    gsap.to(orbit,{rotation:ringN%2?-360:360,duration:34+ringN*14,ease:'none',repeat:-1});
  }
  gsap.to(v.querySelector('.orb'),{y:14,duration:4,ease:'sine.inOut',yoyo:true,repeat:-1});
})();

/* ============ MAGNETIC BUTTONS ============ */
if(!isTouch){
  document.querySelectorAll('.btn, .navcta').forEach(btn=>{
    btn.addEventListener('pointermove',e=>{
      const r=btn.getBoundingClientRect();
      const mx=e.clientX-r.left-r.width/2, my=e.clientY-r.top-r.height/2;
      gsap.to(btn,{x:mx*.3,y:my*.4,duration:.4,ease:'power3.out'});
    });
    btn.addEventListener('pointerleave',()=>gsap.to(btn,{x:0,y:0,duration:.6,ease:'elastic.out(1,.4)'}));
  });
}

/* ============ SPOTLIGHT CARDS ============ */
document.querySelectorAll('.bcard').forEach(card=>{
  card.addEventListener('pointermove',e=>{
    const r=card.getBoundingClientRect();
    card.style.setProperty('--mx',(e.clientX-r.left)+'px');
    card.style.setProperty('--my',(e.clientY-r.top)+'px');
  });
});
/* card tilt */
if(!isTouch){
  document.querySelectorAll('[data-tilt]').forEach(card=>{
    card.addEventListener('pointermove',e=>{
      const r=card.getBoundingClientRect();
      const px=(e.clientX-r.left)/r.width-.5, py=(e.clientY-r.top)/r.height-.5;
      gsap.to(card,{rotationY:px*7,rotationX:-py*7,transformPerspective:900,duration:.4,ease:'power2.out'});
    });
    card.addEventListener('pointerleave',()=>gsap.to(card,{rotationX:0,rotationY:0,duration:.7,ease:'elastic.out(1,.5)'}));
  });
}

/* ============ FAQ ACCORDION ============ */
document.querySelectorAll('.q').forEach(q=>{
  const head=q.querySelector('.qh'), ans=q.querySelector('.qa');
  head.addEventListener('click',()=>{
    const open=q.classList.contains('open');
    document.querySelectorAll('.q.open').forEach(o=>{if(o!==q){o.classList.remove('open');gsap.to(o.querySelector('.qa'),{height:0,duration:.5,ease:'expo.out'});}});
    if(open){q.classList.remove('open');gsap.to(ans,{height:0,duration:.5,ease:'expo.out'});}
    else{q.classList.add('open');gsap.set(ans,{height:'auto'});const h=ans.offsetHeight;gsap.fromTo(ans,{height:0},{height:h,duration:.6,ease:'expo.out'});}
  });
});

/* ============ NAV SCROLL STATE ============ */
ScrollTrigger.create({start:'top -80',end:99999,
  onUpdate:self=>{document.querySelector('nav').style.padding=self.direction===1&&window.scrollY>120?'14px clamp(20px,4vw,64px)':'22px clamp(20px,4vw,64px)';}
});

/* init after load */
window.addEventListener('load',()=>{
  initReveals();
  initHorizontal();
  initMarquee();
  ScrollTrigger.refresh();
});
