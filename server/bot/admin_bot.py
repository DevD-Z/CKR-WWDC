import discord
from discord import app_commands
from discord.ext import commands
import httpx
import os
from typing import Optional

API_BASE = os.environ.get("CKR_API_BASE", "https://ckr-wwdc-x0pe.onrender.com")
TOKEN = os.environ.get("CKR_DISCORD_TOKEN", "")
ADMIN_USERNAME = os.environ.get("CKR_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("CKR_ADMIN_PASS", "")

_access_token: Optional[str] = None


async def _login() -> str:
    global _access_token
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            f"{API_BASE}/api/auth/login",
            json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
        )
        if r.status_code != 200:
            raise RuntimeError(f"Login failed: {r.text}")
        data = r.json()
        _access_token = data["access_token"]
        return _access_token


async def _api(method: str, path: str, body: dict = None):
    global _access_token
    if not _access_token:
        await _login()
    headers = {"Authorization": f"Bearer {_access_token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.request(method, f"{API_BASE}{path}", headers=headers, json=body)
    if r.status_code == 401:
        await _login()
        headers["Authorization"] = f"Bearer {_access_token}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.request(method, f"{API_BASE}{path}", headers=headers, json=body)
    return r


intents = discord.Intents.default()
bot = commands.Bot(command_prefix="!", intents=intents)


@bot.event
async def on_ready():
    print(f"Logged in as {bot.user}")
    try:
        synced = await bot.tree.sync()
        print(f"Synced {len(synced)} commands")
    except Exception as e:
        print(f"Sync error: {e}")


# ─────────────────────────────────────────────────
# Buttons
# ─────────────────────────────────────────────────
class AdminView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="📝 สร้าง User", style=discord.ButtonStyle.green, custom_id="btn_create")
    async def btn_create(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(CreateUserModal())

    @discord.ui.button(label="💰 เติม Token", style=discord.ButtonStyle.blurple, custom_id="btn_add")
    async def btn_add(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(AddTokensModal())

    @discord.ui.button(label="🔻 หัก Token", style=discord.ButtonStyle.red, custom_id="btn_remove")
    async def btn_remove(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(RemoveTokensModal())

    @discord.ui.button(label="👤 ดูข้อมูล User", style=discord.ButtonStyle.grey, custom_id="btn_info")
    async def btn_info(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(UserInfoModal())

    @discord.ui.button(label="👥 รายชื่อ Users", style=discord.ButtonStyle.blurple, custom_id="btn_list")
    async def btn_list(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer()
        try:
            r = await _api("GET", "/api/admin/users")
            data = r.json()
            if data.get("ok") and data.get("users"):
                users = data["users"]
                lines = []
                for u in users:
                    badge = "🟢" if u.get("role") == "admin" else "👤"
                    lines.append(f"{badge} **{u.get('username', '?')}** — {u.get('token_balance', 0)} tokens")
                embed = discord.Embed(
                    title=f"👥 Users ทั้งหมด ({len(users)})",
                    description="\n".join(lines) if lines else "ยังไม่มี users",
                    color=discord.Color.blue()
                )
                await interaction.followup.send(embed=embed, ephemeral=True)
            else:
                await interaction.followup.send("❌ ไม่มี users", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ Error: {e}", ephemeral=True)

    @discord.ui.button(label="🏥 สถานะ API", style=discord.ButtonStyle.grey, custom_id="btn_health")
    async def btn_health(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer()
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(f"{API_BASE}/api/health")
            data = r.json()
            ok = data.get("ok", False)
            embed = discord.Embed(
                title="🏥 API Health" if ok else "❌ API Error",
                color=discord.Color.green() if ok else discord.Color.red()
            )
            embed.add_field(name="Service", value=data.get("service", "?"), inline=True)
            embed.add_field(name="Farm", value="🟢 ว่าง" if not data.get("farm_busy") else "🔴 ไม่ว่าง", inline=True)
            embed.add_field(name="Supabase", value="✅" if data.get("supabase_configured") else "❌", inline=True)
            embed.add_field(name="Service Role", value="✅" if data.get("service_role_configured") else "❌", inline=True)
            await interaction.followup.send(embed=embed, ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ Error: {e}", ephemeral=True)


# ─────────────────────────────────────────────────
# Modals
# ─────────────────────────────────────────────────
class CreateUserModal(discord.ui.Modal, title="📝 สร้าง user ใหม่"):
    username = discord.ui.TextInput(label="ชื่อผู้ใช้", placeholder="เช่น LARP", required=True, max_length=64)
    password = discord.ui.TextInput(label="รหัสผ่าน", placeholder="เช่น hotdog.devztest", required=True, max_length=128)
    tokens = discord.ui.TextInput(label="Token เริ่มต้น", placeholder="50", required=False, default="0", max_length=10)

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer()
        try:
            tokens = int(self.tokens.value) if self.tokens.value.strip() else 0
            r = await _api("POST", "/api/admin/create-user", {
                "username": self.username.value.strip(),
                "password": self.password.value,
                "initial_tokens": tokens,
            })
            data = r.json()
            if data.get("ok"):
                embed = discord.Embed(title="✅ สร้าง user สำเร็จ", color=discord.Color.green())
                embed.add_field(name="Username", value=data.get("username", self.username.value))
                embed.add_field(name="Tokens", value=str(data.get("token_balance", tokens)))
                embed.set_footer(text=f"โดย {interaction.user.display_name}")
                await interaction.followup.send(embed=embed)
            else:
                await interaction.followup.send(f"❌ {data.get('detail', data.get('reason', 'unknown_error'))}", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ Error: {e}", ephemeral=True)


class AddTokensModal(discord.ui.Modal, title="💰 เติม token"):
    query = discord.ui.TextInput(label="Username", placeholder="เช่น LARP", required=True, max_length=64)
    amount = discord.ui.TextInput(label="จำนวน token", placeholder="100", required=True, max_length=10)

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer()
        try:
            amount = int(self.amount.value.strip())
            r = await _api("POST", "/api/admin/add-tokens", {
                "query": self.query.value.strip(),
                "amount": amount,
            })
            data = r.json()
            if data.get("ok"):
                embed = discord.Embed(title="💰 เติม token สำเร็จ", color=discord.Color.green())
                embed.add_field(name="User", value=data.get("username", self.query.value))
                embed.add_field(name="Balance", value=str(data.get("token_balance", "?")))
                embed.add_field(name="+ เติม", value=str(amount))
                embed.set_footer(text=f"โดย {interaction.user.display_name}")
                await interaction.followup.send(embed=embed)
            else:
                await interaction.followup.send(f"❌ {data.get('detail', data.get('reason', 'not_found'))}", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ Error: {e}", ephemeral=True)


class RemoveTokensModal(discord.ui.Modal, title="🔻 หัก token"):
    query = discord.ui.TextInput(label="Username", placeholder="เช่น LARP", required=True, max_length=64)
    amount = discord.ui.TextInput(label="จำนวน token ที่จะหัก", placeholder="50", required=True, max_length=10)

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer()
        try:
            amount = int(self.amount.value.strip())
            r = await _api("POST", "/api/admin/add-tokens", {
                "query": self.query.value.strip(),
                "amount": -amount,
            })
            data = r.json()
            if data.get("ok"):
                embed = discord.Embed(title="🔻 หัก token สำเร็จ", color=discord.Color.orange())
                embed.add_field(name="User", value=data.get("username", self.query.value))
                embed.add_field(name="Balance", value=str(data.get("token_balance", "?")))
                embed.add_field(name="- หัก", value=str(amount))
                embed.set_footer(text=f"โดย {interaction.user.display_name}")
                await interaction.followup.send(embed=embed)
            else:
                await interaction.followup.send(f"❌ {data.get('detail', data.get('reason', 'not_found'))}", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ Error: {e}", ephemeral=True)


class UserInfoModal(discord.ui.Modal, title="👤 ดูข้อมูล user"):
    query = discord.ui.TextInput(label="Username", placeholder="เช่น LARP", required=True, max_length=64)

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer()
        try:
            r = await _api("GET", f"/api/admin/lookup?q={self.query.value.strip()}")
            data = r.json()
            if data.get("ok"):
                embed = discord.Embed(title=f"👤 {data.get('username', self.query.value)}", color=discord.Color.blue())
                embed.add_field(name="ID", value=f"`{data.get('id', '?')}`", inline=False)
                embed.add_field(name="Display Name", value=data.get("display_name", "—"))
                embed.add_field(name="Role", value=data.get("role", "?"))
                embed.add_field(name="Tokens", value=f"**{data.get('token_balance', 0)}**")
                embed.add_field(name="Created", value=data.get("created_at", "?")[:10] if data.get("created_at") else "?", inline=False)
                await interaction.followup.send(embed=embed)
            else:
                await interaction.followup.send(f"❌ ไม่พบ user `{self.query.value}`", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ Error: {e}", ephemeral=True)


# ─────────────────────────────────────────────────
# /setup — สร้างปุ่ม
# ─────────────────────────────────────────────────
@bot.tree.command(name="setup", description="📋 แผงควบคุม Admin (ปุ่มกด)")
async def cmd_setup(interaction: discord.Interaction):
    embed = discord.Embed(
        title="🛠️ แผงควบคุม Admin",
        description="กดปุ่มด้านล่างเพื่อจัดการระบบ",
        color=discord.Color.purple()
    )
    embed.add_field(name="📝 สร้าง User", value="สร้างบัญชีผู้ใช้ใหม่", inline=True)
    embed.add_field(name="💰 เติม Token", value="เพิ่ม token ให้ user", inline=True)
    embed.add_field(name="🔻 หัก Token", value="หัก token user", inline=True)
    embed.add_field(name="👤 ดูข้อมูล", value="ดูรายละเอียด user", inline=True)
    embed.add_field(name="👥 รายชื่อ", value="ดู users ทั้งหมด", inline=True)
    embed.add_field(name="🏥 สถานะ", value="เช็คระบบ API", inline=True)
    embed.set_footer(text="hotdog. Admin Panel")
    await interaction.response.send_message(embed=embed, view=AdminView())


def main():
    if not TOKEN:
        print("❌ ตั้งค่า CKR_DISCORD_TOKEN ใน environment variables")
        return
    bot.run(TOKEN)


if __name__ == "__main__":
    main()
