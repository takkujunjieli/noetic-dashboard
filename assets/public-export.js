// Imported only by the local, private entry point. Raw data never goes to GitHub here.
export function mountPublicExport() {
  const host = document.querySelector('header .toolbar') || document.querySelector('header');
  const button = document.createElement('button');
  button.textContent = '更新公开快照';
  button.type = 'button';
  const preview = document.createElement('a');
  preview.textContent = '预览公开版';
  const url = new URL(location.href); url.searchParams.set('view','public');
  preview.href = url.href;
  preview.className = 'public-preview-link';
  const status = document.createElement('span'); status.setAttribute('role','status');
  host?.append(button,preview,status);
  button.onclick = async () => {
    button.disabled = true;
    try {
      const raw = localStorage.getItem('research-desk.workflow.v1');
      const body = raw ? {workflow:JSON.parse(raw)} : {};
      const response = await fetch('/api/public-dashboard/export', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '生成失败');
      status.textContent = '公开快照已更新，可预览后发布。';
    } catch (error) { status.textContent = '公开快照未更新：' + error.message; }
    finally { button.disabled = false; }
  };
}
