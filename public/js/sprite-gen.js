/**
 * 🎮 SpriteGen - Procedural Champion Sprite Generator & Animation Engine
 * For Clash of Champion
 * 
 * Features:
 * - 8 Unique RPG Classes (Knight, Mage, Archer, Ninja, Paladin, Cyber, Beast, Alchemist)
 * - 8 Color Palettes with vibrant accents
 * - 4 Skin Tones
 * - Crisp pixel art scaling (Canvas 2D with imageSmoothingEnabled = false)
 * - 5 Animation States (idle, attack, victory, hurt, combo)
 * - Seamless integration with existing emoji avatars (backward compatible)
 */

class SpriteGen {
  static CLASSES = {
    knight: {
      id: 'knight',
      name: 'Ksatria',
      title: 'Brave Knight',
      icon: '⚔️',
      weapon: 'Broadsword & Shield',
      desc: 'Pertahanan tinggi dengan pedang baja dan helm berpelindung.'
    },
    mage: {
      id: 'mage',
      name: 'Penyihir',
      title: 'Arcane Mage',
      icon: '🔮',
      weapon: 'Magic Staff',
      desc: 'Menguasai mantra sihir kuno dengan tongkat kristal bercahaya.'
    },
    archer: {
      id: 'archer',
      name: 'Pemanah',
      title: 'Swift Archer',
      icon: '🏹',
      weapon: 'Recurve Bow',
      desc: 'Cepat dan presisi dengan busur panah dan tudung pemburu.'
    },
    ninja: {
      id: 'ninja',
      name: 'Ninja',
      title: 'Shadow Shinobi',
      icon: '🥷',
      weapon: 'Dual Kunai',
      desc: 'Melesat dalam bayangan dengan topeng rahasia dan belati kembar.'
    },
    paladin: {
      id: 'paladin',
      name: 'Paladin',
      title: 'Holy Paladin',
      icon: '🛡️',
      weapon: 'Warhammer & Radiance',
      desc: 'Prajurit cahaya berzirah emas dengan palu penghukum suci.'
    },
    cyber: {
      id: 'cyber',
      name: 'Cyberpunk',
      title: 'Neo Cyborg',
      icon: '⚡',
      weapon: 'Plasma Saber',
      desc: 'Prajurit masa depan dengan visor neon dan pedang energi plasma.'
    },
    beast: {
      id: 'beast',
      name: 'Beastmaster',
      title: 'Wild Beast',
      icon: '🐾',
      weapon: 'Claw Gauntlets',
      desc: 'Menyatu dengan alam liar, mengenakan mahkota tanduk dan cakar buas.'
    },
    alchemist: {
      id: 'alchemist',
      name: 'Alkemis',
      title: 'Grand Alchemist',
      icon: '🧪',
      weapon: 'Potion Flask',
      desc: 'Ilmuwan eksentrik dengan kacamata goggle dan ramuan peledak.'
    }
  };

  static PALETTES = {
    gold: {
      id: 'gold',
      name: 'Emas Juara',
      primary: '#ffd700',
      secondary: '#ff9800',
      dark: '#b26a00',
      accent: '#ffffff',
      glow: 'rgba(255, 215, 0, 0.7)'
    },
    fire: {
      id: 'fire',
      name: 'Api Membara',
      primary: '#ff3d00',
      secondary: '#ff9100',
      dark: '#bf360c',
      accent: '#ffff00',
      glow: 'rgba(255, 61, 0, 0.7)'
    },
    ice: {
      id: 'ice',
      name: 'Es Abadi',
      primary: '#00e5ff',
      secondary: '#00b0ff',
      dark: '#01579b',
      accent: '#ffffff',
      glow: 'rgba(0, 229, 255, 0.7)'
    },
    shadow: {
      id: 'shadow',
      name: 'Bayangan Ungu',
      primary: '#9c27b0',
      secondary: '#ba68c8',
      dark: '#4a148c',
      accent: '#e1bee7',
      glow: 'rgba(156, 39, 176, 0.7)'
    },
    forest: {
      id: 'forest',
      name: 'Penjaga Rimba',
      primary: '#4caf50',
      secondary: '#8bc34a',
      dark: '#1b5e20',
      accent: '#c8e6c9',
      glow: 'rgba(76, 175, 80, 0.7)'
    },
    cyber: {
      id: 'cyber',
      name: 'Neon Siber',
      primary: '#00e676',
      secondary: '#00b0ff',
      dark: '#263238',
      accent: '#f50057',
      glow: 'rgba(0, 230, 118, 0.7)'
    },
    crimson: {
      id: 'crimson',
      name: 'Merah Satria',
      primary: '#d50000',
      secondary: '#ff1744',
      dark: '#880e4f',
      accent: '#ffcdd2',
      glow: 'rgba(213, 0, 0, 0.7)'
    },
    amethyst: {
      id: 'amethyst',
      name: 'Kristal Mistis',
      primary: '#651fff',
      secondary: '#7c4dff',
      dark: '#311b92',
      accent: '#b388ff',
      glow: 'rgba(101, 31, 255, 0.7)'
    }
  };

  static SKIN_TONES = [
    { skin: '#fcd0a1', shadow: '#d69e6b' }, // Fair
    { skin: '#e5a66e', shadow: '#b87333' }, // Tan
    { skin: '#8d5524', shadow: '#58310c' }, // Dark
    { skin: '#c8e6c9', shadow: '#81c784' }  // Mystic Elf
  ];

  /**
   * Parse avatar string representation
   * Format: "sprite:class:palette:skinIndex:seed" or legacy emoji
   */
  static parse(avatarStr) {
    if (!avatarStr || typeof avatarStr !== 'string') {
      return { isSprite: false, emoji: '🦁' };
    }

    if (avatarStr.startsWith('sprite:')) {
      const parts = avatarStr.split(':');
      const classId = parts[1] || 'knight';
      const paletteId = parts[2] || 'gold';
      const skinIndex = parseInt(parts[3], 10) || 0;
      const seed = parseInt(parts[4], 10) || 12345;

      return {
        isSprite: true,
        class: this.CLASSES[classId] ? classId : 'knight',
        palette: this.PALETTES[paletteId] ? paletteId : 'gold',
        skin: (skinIndex >= 0 && skinIndex < this.SKIN_TONES.length) ? skinIndex : 0,
        seed: seed
      };
    }

    return { isSprite: false, emoji: avatarStr };
  }

  /**
   * Serialize sprite config into string
   */
  static stringify(config) {
    if (!config || !config.isSprite) {
      return config?.emoji || '🦁';
    }
    return `sprite:${config.class || 'knight'}:${config.palette || 'gold'}:${config.skin || 0}:${config.seed || 1000}`;
  }

  /**
   * Generate deterministic sprite from student nickname
   */
  static generateFromNickname(nickname) {
    let hash = 0;
    const str = String(nickname || 'Champion');
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const absHash = Math.abs(hash);

    const classKeys = Object.keys(this.CLASSES);
    const paletteKeys = Object.keys(this.PALETTES);

    const classId = classKeys[absHash % classKeys.length];
    const paletteId = paletteKeys[(absHash >> 3) % paletteKeys.length];
    const skinIndex = (absHash >> 6) % this.SKIN_TONES.length;

    return {
      isSprite: true,
      class: classId,
      palette: paletteId,
      skin: skinIndex,
      seed: absHash % 100000
    };
  }

  /**
   * Generate a completely random sprite
   */
  static random() {
    const classKeys = Object.keys(this.CLASSES);
    const paletteKeys = Object.keys(this.PALETTES);

    const classId = classKeys[Math.floor(Math.random() * classKeys.length)];
    const paletteId = paletteKeys[Math.floor(Math.random() * paletteKeys.length)];
    const skinIndex = Math.floor(Math.random() * this.SKIN_TONES.length);
    const seed = Math.floor(Math.random() * 90000) + 10000;

    return {
      isSprite: true,
      class: classId,
      palette: paletteId,
      skin: skinIndex,
      seed: seed
    };
  }

  /**
   * Draw sprite frame onto canvas 2D context
   * @param {Object} spriteObj 
   * @param {CanvasRenderingContext2D} ctx 
   * @param {number} width 
   * @param {number} height 
   * @param {string} animationState 'idle' | 'attack' | 'victory' | 'hurt' | 'combo'
   * @param {number} frameIndex 0, 1, 2...
   */
  static drawFrame(spriteObj, ctx, width, height, animationState = 'idle', frameIndex = 0) {
    ctx.clearRect(0, 0, width, height);

    const pal = this.PALETTES[spriteObj.palette] || this.PALETTES.gold;
    const skin = this.SKIN_TONES[spriteObj.skin] || this.SKIN_TONES[0];
    const cls = spriteObj.class || 'knight';

    // 16x16 logical grid
    const pixelSize = width / 16;
    ctx.imageSmoothingEnabled = false;

    // Animation offsets
    let yOffset = 0;
    let xOffset = 0;
    let armRaised = false;
    let isFlashed = false;
    let weaponExtend = 0;
    let showStars = false;

    if (animationState === 'idle') {
      yOffset = (frameIndex % 2 === 1) ? 1 : 0;
    } else if (animationState === 'attack') {
      if (frameIndex % 3 === 0) {
        xOffset = -1; // wind-up
      } else if (frameIndex % 3 === 1) {
        xOffset = 2; // thrust
        weaponExtend = 2;
      }
    } else if (animationState === 'victory') {
      armRaised = true;
      yOffset = (frameIndex % 2 === 0) ? -2 : -1;
      showStars = true;
    } else if (animationState === 'hurt') {
      xOffset = (frameIndex % 2 === 0) ? -2 : 1;
      isFlashed = (frameIndex % 2 === 0);
    } else if (animationState === 'combo') {
      yOffset = (frameIndex % 2 === 1) ? 1 : 0;
      armRaised = true;
    }

    // Helper to draw pixel
    const drawPx = (x, y, color) => {
      if (!color) return;
      ctx.fillStyle = isFlashed ? '#ffffff' : color;
      ctx.fillRect((x + xOffset) * pixelSize, (y + yOffset) * pixelSize, pixelSize, pixelSize);
    };

    // Helper to draw rect
    const drawBox = (x1, y1, x2, y2, color) => {
      for (let y = y1; y <= y2; y++) {
        for (let x = x1; x <= x2; x++) {
          drawPx(x, y, color);
        }
      }
    };

    // 0. Shadow (doesn't move with Y offset)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(8 * pixelSize, 14.5 * pixelSize, 5 * pixelSize, 1.5 * pixelSize, 0, 0, Math.PI * 2);
    ctx.fill();

    // 1. Combo / Fire Aura effect
    if (animationState === 'combo') {
      const auraColors = [pal.primary, pal.secondary, '#ffff00', '#ffffff'];
      for (let i = 0; i < 8; i++) {
        const angle = (Date.now() / 150 + i * (Math.PI / 4));
        const rx = 8 + Math.cos(angle) * 6;
        const ry = 8 + Math.sin(angle) * 6;
        ctx.fillStyle = auraColors[i % auraColors.length];
        ctx.fillRect(rx * pixelSize, ry * pixelSize, pixelSize * 1.2, pixelSize * 1.2);
      }
    }

    // 2. Legs & Boots
    drawBox(5, 10, 6, 12, pal.dark); // Left leg
    drawBox(9, 10, 10, 12, pal.dark); // Right leg
    drawBox(4, 13, 6, 13, '#1a1a1a'); // Left boot
    drawBox(9, 13, 11, 13, '#1a1a1a'); // Right boot

    // 3. Body / Torso Armor
    drawBox(5, 6, 10, 9, pal.primary); // Chestplate
    drawBox(6, 7, 9, 8, pal.secondary); // Emblem / inner armor
    drawBox(5, 9, 10, 9, '#333333'); // Belt
    drawBox(7, 9, 8, 9, pal.accent); // Buckle

    // 4. Arms
    if (armRaised) {
      drawBox(3, 3, 4, 6, pal.primary); // Left arm up
      drawBox(11, 3, 12, 6, pal.primary); // Right arm up
      drawPx(3, 2, skin.skin); // Hands
      drawPx(12, 2, skin.skin);
    } else {
      drawBox(3, 6, 4, 8, pal.primary); // Left arm
      drawBox(11, 6, 12, 8, pal.primary); // Right arm
      drawPx(3, 9, skin.skin); // Hands
      drawPx(12, 9, skin.skin);
    }

    // 5. Head & Skin
    drawBox(5, 2, 10, 5, skin.skin);
    drawBox(5, 5, 10, 5, skin.shadow); // Chin shadow

    // 6. Eyes
    if (animationState === 'hurt') {
      // Cross eyes ><
      drawPx(6, 3, '#000000');
      drawPx(7, 4, '#000000');
      drawPx(6, 4, '#000000');
      drawPx(9, 3, '#000000');
      drawPx(8, 4, '#000000');
      drawPx(9, 4, '#000000');
    } else {
      drawPx(6, 3, '#ffffff'); // Eye white
      drawPx(7, 3, '#000000'); // Pupil
      drawPx(9, 3, '#000000'); // Pupil
      drawPx(10, 3, '#ffffff'); // Eye white
    }

    // 7. Class-Specific Headwear & Helmets
    switch (cls) {
      case 'knight':
        drawBox(5, 0, 10, 2, pal.dark); // Helmet dome
        drawBox(4, 2, 5, 4, pal.dark); // Cheek guard
        drawBox(10, 2, 11, 4, pal.dark);
        drawBox(7, 0, 8, 0, pal.accent); // Plume feather
        drawBox(6, 2, 9, 2, pal.primary); // Visor top
        break;

      case 'mage':
        drawBox(7, 0, 8, 0, pal.dark); // Hat tip
        drawBox(6, 1, 9, 1, pal.dark);
        drawBox(5, 2, 10, 2, pal.primary);
        drawBox(3, 3, 12, 3, pal.secondary); // Hat brim
        drawPx(7, 1, pal.accent); // Gem on hat
        break;

      case 'archer':
        drawBox(5, 1, 10, 2, '#4a2c11'); // Leather cap
        drawBox(9, 0, 10, 0, '#4caf50'); // Green feather
        drawPx(11, 0, '#8bc34a');
        break;

      case 'ninja':
        drawBox(5, 1, 10, 2, '#212121'); // Hood
        drawBox(6, 2, 9, 2, pal.primary); // Shinobi headband
        drawBox(5, 4, 10, 5, '#212121'); // Mouth mask
        break;

      case 'paladin':
        drawBox(5, 1, 10, 2, pal.primary); // Gold crown
        drawBox(7, 0, 8, 1, pal.accent); // Holy cross
        drawPx(4, 1, '#ffffff'); // Left wing
        drawPx(11, 1, '#ffffff'); // Right wing
        break;

      case 'cyber':
        drawBox(5, 1, 10, 2, '#263238'); // Cyber helm
        drawBox(5, 3, 10, 3, pal.primary); // Glowing neon visor
        drawPx(5, 2, pal.accent); // Ear piece
        drawPx(10, 2, pal.accent);
        break;

      case 'beast':
        drawBox(5, 1, 10, 2, '#5d4037'); // Pelt
        drawPx(4, 0, '#ffffff'); // Left horn
        drawPx(4, 1, '#ffffff');
        drawPx(11, 0, '#ffffff'); // Right horn
        drawPx(11, 1, '#ffffff');
        break;

      case 'alchemist':
        drawBox(5, 1, 10, 2, '#3e2723'); // Cap
        drawBox(5, 2, 7, 3, pal.secondary); // Left goggle
        drawBox(8, 2, 10, 3, pal.secondary); // Right goggle
        drawPx(6, 3, pal.accent); // Glass shine
        drawPx(9, 3, pal.accent);
        break;
    }

    // 8. Class-Specific Weapons
    const wx = (armRaised ? 12 : 12 + weaponExtend);
    const wy = (armRaised ? 0 : 5);

    switch (cls) {
      case 'knight':
        // Broadsword & Shield
        drawBox(wx, wy, wx + 1, wy + 6, '#e0e0e0'); // Blade
        drawBox(wx - 1, wy + 5, wx + 2, wy + 5, pal.accent); // Crossguard
        drawBox(wx, wy + 6, wx, wy + 7, '#5d4037'); // Hilt
        // Left Shield
        drawBox(2, 6, 4, 10, pal.dark);
        drawBox(3, 7, 3, 9, pal.accent);
        break;

      case 'mage':
        // Magic Staff with Pulsing Orb
        drawBox(wx, wy, wx, wy + 9, '#795548'); // Staff pole
        drawBox(wx - 1, wy - 2, wx + 1, wy, pal.primary); // Orb holder
        drawBox(wx, wy - 2, wx, wy - 1, pal.accent); // Glowing gem
        break;

      case 'archer':
        // Recurve Bow
        drawBox(wx, wy + 1, wx + 1, wy + 1, '#795548');
        drawBox(wx + 1, wy + 2, wx + 2, wy + 6, '#795548'); // Curved bow
        drawBox(wx, wy + 7, wx + 1, wy + 7, '#795548');
        drawBox(wx - 1, wy + 2, wx - 1, wy + 6, 'rgba(255,255,255,0.7)'); // String
        break;

      case 'ninja':
        // Dual Kunai
        drawBox(wx, wy + 2, wx + 1, wy + 5, '#b0bec5');
        drawPx(wx, wy + 1, pal.accent);
        drawBox(2, 7, 3, 9, '#b0bec5'); // Left kunai
        break;

      case 'paladin':
        // Holy Warhammer
        drawBox(wx - 1, wy - 1, wx + 2, wy + 2, pal.primary); // Hammer head
        drawBox(wx, wy - 1, wx + 1, wy + 1, pal.accent); // Inscription
        drawBox(wx, wy + 2, wx, wy + 8, '#5d4037'); // Shaft
        break;

      case 'cyber':
        // Plasma Blade
        drawBox(wx, wy - 1, wx + 1, wy + 5, pal.primary); // Neon beam
        drawBox(wx, wy + 6, wx, wy + 7, '#263238'); // Cyber hilt
        break;

      case 'beast':
        // Claws
        drawBox(wx, wy + 4, wx + 1, wy + 5, '#ffffff'); // Right claw
        drawBox(2, 8, 3, 9, '#ffffff'); // Left claw
        break;

      case 'alchemist':
        // Potion Flask
        drawBox(wx - 1, wy + 3, wx + 2, wy + 6, 'rgba(255,255,255,0.6)'); // Glass
        drawBox(wx, wy + 4, wx + 1, wy + 5, pal.primary); // Liquid
        drawPx(wx, wy + 2, '#8d6e63'); // Cork
        break;
    }

    // 9. Sparkle stars for victory
    if (showStars) {
      const starColors = ['#ffd700', '#ffffff', '#00e5ff'];
      const stColor = starColors[(frameIndex + Date.now()) % starColors.length];
      drawPx(1, 1, stColor);
      drawPx(2, 2, stColor);
      drawPx(14, 1, stColor);
      drawPx(13, 2, stColor);
    }
  }

  /**
   * Create an interactive animated Canvas element
   * @param {Object|string} avatarData 
   * @param {Object} options { size: 48, animation: 'idle', loop: true, className: '' }
   * @returns {HTMLCanvasElement}
   */
  static createCanvas(avatarData, options = {}) {
    const size = options.size || 48;
    const animation = options.animation || 'idle';
    const className = options.className || '';

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.className = `sprite-canvas ${className}`;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    canvas.style.imageRendering = 'pixelated';

    const ctx = canvas.getContext('2d');
    const spriteObj = (typeof avatarData === 'string') ? this.parse(avatarData) : avatarData;

    if (!spriteObj || !spriteObj.isSprite) {
      // Draw fallback emoji if not a sprite
      ctx.font = `${size * 0.75}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(spriteObj?.emoji || avatarData || '🦁', size / 2, size / 2);
      return canvas;
    }

    let frame = 0;
    let animId = null;
    let lastTime = 0;
    const fpsInterval = 220; // ~4.5 fps for authentic retro feel

    const animate = (time) => {
      if (!canvas.isConnected && options.stopWhenDisconnected !== false) {
        cancelAnimationFrame(animId);
        return;
      }

      if (time - lastTime >= fpsInterval) {
        lastTime = time;
        frame++;
        this.drawFrame(spriteObj, ctx, size, size, canvas.dataset.animation || animation, frame);
      }
      animId = requestAnimationFrame(animate);
    };

    // Draw initial frame immediately
    this.drawFrame(spriteObj, ctx, size, size, animation, 0);

    if (options.animated !== false) {
      animId = requestAnimationFrame(animate);
      canvas._stopAnim = () => cancelAnimationFrame(animId);
    }

    canvas.dataset.animation = animation;
    canvas.setAnimation = (newAnim) => {
      canvas.dataset.animation = newAnim;
      frame = 0;
    };

    return canvas;
  }

  /**
   * Render avatar to HTML string (Canvas wrapper or emoji fallback)
   */
  static renderAvatarHtml(avatarData, options = {}) {
    const size = options.size || 32;
    const anim = options.animation || 'idle';
    const parsed = typeof avatarData === 'string' ? this.parse(avatarData) : avatarData;

    if (!parsed || !parsed.isSprite) {
      return `<span class="avatar-small avatar-emoji" style="font-size:${size * 0.7}px; width:${size}px; height:${size}px; display:inline-flex; align-items:center; justify-content:center;">${parsed?.emoji || avatarData || '🦁'}</span>`;
    }

    // For sprites, return a container with data attributes so scripts can hydrate or render canvas
    const encoded = this.stringify(parsed);
    return `<span class="sprite-avatar-wrap" data-sprite="${encoded}" data-size="${size}" data-anim="${anim}" style="display:inline-block; width:${size}px; height:${size}px; vertical-align:middle;"></span>`;
  }

  /**
   * Hydrate all .sprite-avatar-wrap elements in a container with live canvas
   */
  static hydrate(container = document) {
    container.querySelectorAll('.sprite-avatar-wrap:not([data-hydrated])').forEach(wrap => {
      wrap.setAttribute('data-hydrated', 'true');
      const spriteStr = wrap.dataset.sprite;
      const size = parseInt(wrap.dataset.size, 10) || 32;
      const anim = wrap.dataset.anim || 'idle';
      const canvas = this.createCanvas(spriteStr, { size, animation: anim });
      wrap.innerHTML = '';
      wrap.appendChild(canvas);
    });
  }
}

// Attach to window
if (typeof window !== 'undefined') {
  window.SpriteGen = SpriteGen;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpriteGen;
}
