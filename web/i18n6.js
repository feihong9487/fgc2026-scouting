// FGC 2026 Scouting — translations part 6: visual effects setting.
(function(){
const I = window.I18N, ADD = {
en:{"d.effects":"Visual effects","d.effectsH":"embers, glow, animations","d.on":"On","d.off":"Off"},
"zh-Hant":{"d.effects":"特效","d.effectsH":"火星粒子、光暈、動畫","d.on":"全開","d.off":"關閉"},
"zh-Hans":{"d.effects":"特效","d.effectsH":"火星粒子、光晕、动画","d.on":"全开","d.off":"关闭"},
es:{"d.effects":"Efectos visuales","d.effectsH":"brasas, brillo, animaciones","d.on":"Sí","d.off":"No"},
fr:{"d.effects":"Effets visuels","d.effectsH":"braises, halo, animations","d.on":"Activés","d.off":"Désactivés"},
pt:{"d.effects":"Efeitos visuais","d.effectsH":"brasas, brilho, animações","d.on":"Ligados","d.off":"Desligados"},
de:{"d.effects":"Visuelle Effekte","d.effectsH":"Funken, Leuchten, Animationen","d.on":"An","d.off":"Aus"},
it:{"d.effects":"Effetti visivi","d.effectsH":"braci, bagliore, animazioni","d.on":"Attivi","d.off":"Disattivi"},
ru:{"d.effects":"Визуальные эффекты","d.effectsH":"искры, свечение, анимации","d.on":"Вкл","d.off":"Выкл"},
tr:{"d.effects":"Görsel efektler","d.effectsH":"kıvılcım, parıltı, animasyon","d.on":"Açık","d.off":"Kapalı"},
ar:{"d.effects":"المؤثرات البصرية","d.effectsH":"الشرر والتوهج والحركة","d.on":"تشغيل","d.off":"إيقاف"},
hi:{"d.effects":"विज़ुअल इफ़ेक्ट","d.effectsH":"चिंगारी, चमक, एनिमेशन","d.on":"चालू","d.off":"बंद"},
bn:{"d.effects":"ভিজ্যুয়াল ইফেক্ট","d.effectsH":"স্ফুলিঙ্গ, আভা, অ্যানিমেশন","d.on":"চালু","d.off":"বন্ধ"},
ur:{"d.effects":"بصری اثرات","d.effectsH":"چنگاریاں، چمک، اینیمیشن","d.on":"آن","d.off":"آف"},
id:{"d.effects":"Efek visual","d.effectsH":"bara, cahaya, animasi","d.on":"Nyala","d.off":"Mati"},
ja:{"d.effects":"エフェクト","d.effectsH":"火の粉・グロー・アニメーション","d.on":"オン","d.off":"オフ"},
ko:{"d.effects":"시각 효과","d.effectsH":"불티, 발광, 애니메이션","d.on":"켬","d.off":"끔"},
vi:{"d.effects":"Hiệu ứng","d.effectsH":"tàn lửa, ánh sáng, chuyển động","d.on":"Bật","d.off":"Tắt"},
sw:{"d.effects":"Athari za picha","d.effectsH":"cheche, mwanga, uhuishaji","d.on":"Washa","d.off":"Zima"},
fa:{"d.effects":"جلوه‌های تصویری","d.effectsH":"جرقه، درخشش، انیمیشن","d.on":"روشن","d.off":"خاموش"}
};
Object.keys(ADD).forEach(function(l){ I[l]=Object.assign(I[l]||{},ADD[l]); });
})();
