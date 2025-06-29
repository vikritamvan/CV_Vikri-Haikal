const form = document.getElementById("chat-form");
const input = document.getElementById("user-input");
const chatBox = document.getElementById("chat-box");

form.addEventListener("submit", async function (e) {
  e.preventDefault();

  const userMessage = input.value.trim();
  if (!userMessage) return;

  appendMessage(userMessage, "user");
  input.value = "";
  showTyping();

  try {
    // === Kirim ke server ===
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: userMessage }),
    });

    const data = await response.json();
    removeTyping();

    const reply = data.reply;
    if (!reply) {
      appendMessage("⚠️ Tidak ada balasan dari server.", "bot");
      return;
    }

    appendMessage(reply, "bot");
  } catch (error) {
    removeTyping();
    console.error("Error:", error);
    appendMessage(
      "❌ Terjadi kesalahan koneksi. Silakan coba lagi nanti.",
      "bot"
    );
  }
});

function appendMessage(text, sender) {
  const msg = document.createElement("div");
  msg.classList.add("message", sender);

  if (sender === "bot" && /<\/?[a-z][\s\S]*>/i.test(text)) {
    msg.innerHTML = text;
  } else {
    msg.textContent = text;
  }

  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function showTyping() {
  const typing = document.createElement("div");
  typing.classList.add("message", "bot", "typing");
  typing.id = "typing";
  typing.textContent = "Mengetik...";
  chatBox.appendChild(typing);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function removeTyping() {
  const typing = document.getElementById("typing");
  if (typing) typing.remove();
}
