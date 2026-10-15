import { useState } from 'react';
import Icon from '../components/Icons';
import { version } from '../../package.json';
import { usePwaUpdate } from './client';
import './pwa.css';

export default function PwaInstallHelp() {
  const update = usePwaUpdate();
  const [confirm, setConfirm] = useState(false);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && navigator.standalone === true);
  return <section className="pwa-help" aria-label="安装与离线使用">
    <div className="pwa-help-heading"><span><Icon name="orbit" size={21} /></span><div><h3>{standalone ? '观景室已在手边' : '放到 iPhone 主屏幕'}</h3><p>一个入口，打开自己的空间。</p></div></div>
    {!standalone && <ol><li>用 Safari 打开这个网址。</li><li>点分享按钮，选择“添加到主屏幕”。</li><li>确认名称为“人生”，再点“添加”。若看到“作为网页 App 打开”，保持开启。</li></ol>}
    <p className="pwa-help-status">{update.offlineReady ? '离线入口已准备好。断网时仍可打开已加载的空间。' : '联网打开一次后，会准备离线入口。'}</p>
    {update.updateAvailable && <div className="pwa-update"><p>有新版本，更新前会先保存当前输入。</p>{confirm ? <><p>现在保存并重新打开观景室？</p><div><button type="button" disabled={update.updating} onClick={() => setConfirm(false)}>稍后</button><button type="button" className="pwa-update-primary" disabled={update.updating} onClick={() => { void update.applyUpdate(); }}>{update.updating ? '正在保存并更新…' : '保存并更新'}</button></div></> : <button type="button" className="pwa-update-primary" onClick={() => setConfirm(true)}>查看更新</button>}</div>}
    {update.error && <p className="pwa-help-error" role="status">{update.error}</p>}
    <p className="pwa-help-version">人生 · {version}</p>
  </section>;
}
