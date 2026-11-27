export const styles = `
.dsh-bi{--ink:var(--dsw-alias-label-primary,#23252b);--muted:var(--dsw-alias-label-secondary,#6a6e77);--surface:var(--dsw-alias-bg-base,#fff);--line:var(--dsw-alias-border-l2,#e5e6e9);--hover:var(--dsw-alias-interactive-bg-hover,#f0f1f4);--accent:var(--dsw-alias-state-business-primary,#3663ce);--desk:var(--dsw-alias-bg-document-preview,#f1f2f4);font:13px/1.5 var(--dsw-font-family,system-ui),sans-serif;color:var(--ink);background:var(--surface);position:relative;isolation:isolate;display:flex;flex-flow:column;flex:1;min-width:0;min-height:0;width:100%;height:100%;overflow:hidden;container-type:inline-size;padding-top:var(--dsh-frame-top-clearance,0px)}
.dsh-bi.rd-embedded{padding:0;white-space:normal}
.dsh-bi *,.dsh-bi *::before,.dsh-bi *::after{box-sizing:border-box}
.dsh-bi button,.dsh-bi input,.dsh-bi select,.dsh-bi textarea{font:inherit;color:inherit}
.dsh-bi button{border:0;background:none;cursor:pointer}
.dsh-bi button:disabled{opacity:.4;cursor:default}
.dsh-bi :focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.dsh-bi button:hover:not(:disabled){background:var(--hover)}
.rd-tabs,.rd-tools,.rd-product,.rd-tab,.rd-page,.rd-icon,.rd-tool,.rd-tab-name,.rd-status,.rd-progress,.rd-chat-title,.rd-compose-foot,.rd-ask-pill,.rd-primary,.bi-ask-fab{display:flex;align-items:center}
.rd-tabs,.rd-tools{z-index:4;gap:8px;padding:0 clamp(10px,2.2%,28px);flex:none;min-width:0;border-bottom:1px solid var(--line);background:var(--surface)}
.rd-tabs{height:45px;z-index:7;background:color-mix(in srgb,var(--surface) 92%,var(--hover));padding-top:3px}
.rd-product{gap:9px;color:var(--muted);white-space:nowrap;margin-right:8px}
.rd-tab{min-width:0;max-width:60%;position:relative;gap:6px;padding:0 9px;border:1px solid var(--line);border-radius:10px;box-shadow:0 1px 3px #00000008;background:var(--surface)}
.rd-tab-name{gap:6px;min-width:0;height:31px;padding:0 2px;font-weight:550!important}
.rd-tab-name span,.rd-recent button span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rd-file-mark{display:grid;place-items:center;font:700 10px/1 system-ui;background:#e7effe;color:#3564b1;width:20px;height:22px;border-radius:4px;flex:none}
.rd-file-mark.pdf{color:#ae4a42;background:#fae8e6}
.rd-tools{min-height:44px;gap:5px;flex-wrap:wrap;padding-block:5px}
.rd-tools>i{width:1px;height:17px;background:var(--line);margin:0 4px}
.rd-icon,.rd-percent,.rd-tool,.rd-mini{justify-content:center;flex:none;border-radius:7px}
.rd-icon{width:30px;height:30px;padding:0}
.rd-percent,.rd-tool{height:31px;padding:0 8px;white-space:nowrap}
.rd-tool{gap:6px}.rd-tool.on,.rd-icon[aria-expanded=true]{background:var(--hover)}
.rd-percent,.rd-page{font-variant-numeric:tabular-nums}
.rd-page{gap:5px;white-space:nowrap;color:var(--muted)}
.rd-page input{width:3.1ch;min-width:30px;border:0;border-radius:5px;background:var(--hover);text-align:center}
.rd-grow{flex:1}.rd-menu-wrap{position:relative}
.rd-menu,.rd-outline,.rd-chat,.rd-ask-pill,.bi-ask-fab{background:var(--surface);border:1px solid var(--line);box-shadow:0 6px 28px #10182818,0 1px 4px #00000009}
.rd-menu{position:absolute;top:calc(100% + 6px);padding:6px;border-radius:12px;z-index:10;min-width:210px}
.rd-options{right:0}.rd-recent{left:0;max-width:min(320px,75cqw)}
.rd-menu button,.rd-menu label{display:flex;align-items:center;gap:9px;text-align:left;width:100%;padding:7px 9px;border-radius:7px;min-height:32px}
.rd-menu-heading,.rd-model{font-size:11px;color:var(--muted);padding:4px 9px;overflow-wrap:anywhere}
.rd-menu label{justify-content:space-between}.rd-menu select{max-width:110px;border:1px solid var(--line);border-radius:5px;background:var(--surface)}
.rd-menu input{accent-color:var(--accent)}.rd-rule{border-top:1px solid var(--line);margin:4px 0}
.rd-status,.rd-progress{gap:9px;font-size:12px;padding:5px 16px;flex:none;background:var(--hover);z-index:2}
.rd-status span{flex:1}.rd-status .rd-icon{width:22px;height:22px}.rd-progress button{color:var(--accent)}
.rd-progress progress{height:5px;max-width:140px;accent-color:var(--accent)}
.rd-stage{position:relative;flex:1;min-height:0;display:flex;overflow:hidden}
.rd-viewport{flex:1;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;background:var(--desk)}
.rd-viewport.region{user-select:none;touch-action:none;cursor:crosshair}
.rd-crop{pointer-events:none;position:absolute;border:1px solid var(--accent);background:#5682ff26;z-index:9}
.rd-desk{width:calc(100% * var(--scale));min-height:100%;margin:0 auto;padding:12px clamp(8px,1.6%,24px) 83px}
.rd-spread{display:grid;grid-template-columns:minmax(0,1fr);max-width:calc(815px * var(--scale));margin:0 auto 13px;gap:12px;scroll-margin:10px}
.paired .rd-spread{grid-template-columns:repeat(2,minmax(0,1fr));max-width:calc(1580px * var(--scale))}
.rd-sheet{background:#fff;color:#25282b;min-width:0;container-type:inline-size;box-shadow:0 1px 4px #17212e10;position:relative;align-self:stretch}
.rd-paper{padding:6% 9.3% 5.6%;min-height:129cqw;display:flex;flex-direction:column}
.rd-paper>header,.rd-paper>footer{font:500 clamp(8px,1.35cqw,11px)/1.4 system-ui,sans-serif;color:#667179}
.rd-paper>header{margin:0 0 4.6cqw;letter-spacing:.035em}
.rd-paper>footer{display:flex;gap:1em;justify-content:flex-end;margin-top:auto;padding-top:4cqw}
.rd-typeset{font:clamp(11px,2.18cqw,21px)/1.48 Georgia,"Songti SC","Noto Serif CJK SC",serif;overflow-wrap:anywhere}
.rd-sheet.target .rd-typeset{line-height:1.67}
.rd-block{border-radius:2px;position:relative}.rd-para{white-space:pre-line;margin:0 0 .85em;color:inherit;font-size:inherit;line-height:inherit}
h1.rd-para{font-size:2.02em;line-height:1.14;letter-spacing:-.025em;margin:.1em 0 .6em}
h2.rd-para{font-size:1.24em;line-height:1.32;margin:1.1em 0 .35em}
h3.rd-para,h4.rd-para,h5.rd-para,h6.rd-para{font-size:1.08em;line-height:1.35;margin:.8em 0 .3em}
.rd-para.marked{text-decoration:underline;text-decoration-color:#c39a46;text-underline-offset:3px}
.rd-block.selected>.rd-para{background:#6688b80b}
.rd-para.pending,.rd-typeset>.pending{color:#9196a0;font:12px/1.6 system-ui,sans-serif}
.rd-para small{font:10px system-ui;color:#946a12;margin-left:5px}
.rd-figure{display:block;max-width:100%;height:auto;margin:.8em auto}
.rd-table-wrap{overflow:auto;margin:.6em 0}.rd-table-wrap table{border-collapse:collapse;width:100%;font:inherit;font-size:.9em}
.rd-table-wrap td{border:1px solid #cdd2d7;padding:.3em .45em;vertical-align:top}
.rd-table-wrap .rd-para{margin:0}.rd-table-wrap tr:first-child{background:#f2f4f5}
.rd-edit{padding:4px 0}.rd-edit textarea{display:block;width:100%;resize:vertical;border:1px solid #d9dde2;border-radius:5px;color:#222;background:#fff;padding:5px;line-height:1.5}
.rd-mini{font:11px/1.4 system-ui!important;padding:3px 5px;color:var(--muted);display:inline-flex;align-items:center;gap:4px}
.rd-edit .rd-mini{color:#596575}.rd-sheet ::selection{background:#b9d8ff}
.bi-pdf-page{position:relative;overflow:hidden;container-type:inline-size;background:#fff}
.bi-pdf-image,.bi-pdf-words{position:absolute;inset:0;width:100%;height:100%}.bi-pdf-image{user-select:none}
.bi-word{position:absolute;color:transparent;white-space:pre;line-height:1;cursor:text}
.bi-word::selection{color:transparent;background:#318bf961}.bi-word--marked{background:#f9cf5d44}
.rd-sheet ::highlight(dsh-bilingual-counterpart){background-color:rgba(255,192,51,.58)}
.rd-sheet .rd-linked-selection{background-color:rgba(255,192,51,.58)}
.bi-word--active{background:#5598db22}.bi-pdf-words--plain .bi-word{color:#272a2d}
.bi-pdf-page-number,.bi-pdf-scan{position:absolute;right:7px;bottom:5px;font:10px system-ui;color:#65707b;background:#ffffffc9}
.bi-pdf-scan{bottom:auto;top:8px}
.rd-outline{position:absolute;z-index:3;inset:6px auto 14px 8px;width:min(236px,85%);overflow:auto;border-radius:12px;padding:7px}
.rd-outline header,.rd-outline button{display:flex;align-items:center;justify-content:space-between;gap:8px}
.rd-outline header{padding:3px 3px 7px 8px;font-weight:600;border-bottom:1px solid var(--line)}
.rd-outline>button{width:100%;text-align:left;border-radius:6px;padding:8px;justify-content:flex-start}
.rd-outline>button span:first-child{color:var(--muted);min-width:17px}
.rd-outline>button span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rd-outline button[aria-current=page]{background:var(--hover)}
.dsh-bi .rd-ask-pill{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);height:41px;padding:0 21px;border:1px solid var(--line);border-radius:18px;gap:10px;background:var(--surface);box-shadow:0 3px 18px #10182818;white-space:nowrap}
.bi-ask-fab{position:absolute;z-index:12;gap:6px;height:32px;padding:0 12px;border-radius:9px}
.dsh-bi .bi-ask-fab{background:var(--surface);border:1px solid var(--line)}
.rd-chat{position:absolute;z-index:5;right:14px;bottom:14px;width:min(365px,calc(100% - 28px));height:min(460px,calc(100% - 28px));display:flex;flex-flow:column;border-radius:16px;overflow:hidden}
.rd-chat-title{padding:10px 12px 8px 16px;gap:8px;border-bottom:1px solid var(--line)}.rd-chat-title strong{flex:1}
.rd-thread{padding:14px;overflow:auto;min-height:0;flex:1}
.rd-chat-empty{font-size:13px;color:var(--muted);margin:12px 3px}
.rd-thread article{display:flex;align-items:flex-start;flex-flow:column;margin:0 0 16px;gap:7px}
.rd-question{align-self:flex-end;background:var(--hover);border-radius:12px 12px 3px 12px;padding:7px 11px;max-width:92%}
.rd-answer,.rd-question{line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}
.rd-answer.failed{color:#c54438}.rd-chat-tools{display:flex;align-items:center}.rd-chat-tools .rd-icon{width:24px;height:24px}
.rd-citation,.rd-quote{border-left:2px solid #90a6cd!important;color:var(--muted)!important;font-size:12px!important;padding:3px 8px;max-width:100%;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rd-compose{border:1px solid var(--line);border-radius:12px;margin:0 10px 10px;padding:8px;background:var(--surface)}
.rd-crop-preview{display:block;max-height:70px;max-width:100%;object-fit:contain;margin-bottom:5px;border-radius:4px}
.rd-compose textarea{border:0;outline:0;background:none;resize:none;width:100%;min-height:43px;max-height:100px}
.rd-compose-foot{justify-content:space-between;gap:6px;color:var(--muted);font-size:11px}
.rd-compose-foot span,.rd-quote span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.rd-quote{display:flex;align-items:center;justify-content:space-between;gap:3px;margin-bottom:5px}.rd-quote .rd-icon{width:20px;height:20px}
.dsh-bi .rd-send,.dsh-bi .rd-primary{color:white;background:#345eca;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;gap:7px}
.dsh-bi .rd-send{height:28px;width:30px}.dsh-bi .rd-primary{padding:10px 19px}.dsh-bi .rd-primary:hover,.dsh-bi .rd-send:hover:not(:disabled){background:#294fab}
.rd-home{display:grid;place-items:center;flex:1;padding:20px;background:var(--surface);overflow:auto}
.rd-welcome{text-align:center;margin-bottom:5vh}.rd-book{display:grid;place-items:center;margin:auto;color:var(--accent);width:68px;height:68px;border:1px solid var(--line);border-radius:19px;box-shadow:0 4px 12px #00000009}
.rd-welcome h1{font-size:25px;letter-spacing:-.025em;margin:20px 0 8px}.rd-welcome p,.rd-welcome small{color:var(--muted)}
.rd-welcome p{margin:0 0 23px}.rd-welcome small{display:block;margin:13px 0;font-size:11px}
.rd-drop-overlay{z-index:20;position:absolute;inset:5px;display:grid;place-items:center;pointer-events:none;background:color-mix(in srgb,var(--surface) 90%,transparent);color:var(--accent);border:2px dashed var(--accent);border-radius:12px;font-size:18px}
@container(max-width:640px){.rd-tabs,.rd-tools{padding-inline:8px;gap:2px}.rd-tools>i{margin:0 1px}.rd-tool{padding-inline:5px}.rd-product{margin-right:3px}.rd-spread{gap:7px}.rd-desk{padding-inline:7px}.rd-product span{display:none}}
@container(max-width:510px){.paired .rd-spread{grid-template-columns:minmax(0,1fr);gap:3px}.rd-paper{min-height:auto;padding:7% 8%}.rd-ask-pill{bottom:9px}.rd-percent{padding-inline:3px}.rd-icon{width:27px}.rd-tools{row-gap:1px}.rd-tool{font-size:12px!important}.rd-tabs{height:40px}}
`
