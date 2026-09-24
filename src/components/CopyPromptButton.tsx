import React, { useState } from 'react';
import { ClipboardCopy, Check } from 'lucide-react';
import { useStore } from '../store';
import { buildAiPrompt } from '../aiPrompt';

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API can be unavailable (non-HTTPS, permissions); fall back to a hidden textarea
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

export const CopyPromptButton: React.FC<{ className?: string }> = ({ className }) => {
  const paperSize = useStore((s) => s.paperSize);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await copyText(buildAiPrompt(paperSize));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <button
      onClick={handleCopy}
      className={className}
      title="Salin instruksi format untuk ChatGPT / Google AI Studio agar hasil HTML-nya rapi di editor ini"
    >
      {copied ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
      <span>{copied ? 'Prompt tersalin!' : 'Salin Prompt AI'}</span>
    </button>
  );
};
