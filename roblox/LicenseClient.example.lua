-- Contoh integrasi server-side Roblox.
-- Simpan sebagai Script/ModuleScript di ServerScriptService, bukan LocalScript.
-- Aktifkan Game Settings > Security > Allow HTTP Requests.

local HttpService = game:GetService("HttpService")

local LicenseClient = {}

local VERIFY_URL = "https://kitnaka-license-api.vercel.app/api/verify"
local PRODUCT = "kit-naka"
local SYSTEM_VERSION = "2.3.1"

-- Akses diberikan lewat status lisensi aktif di dashboard.
-- Tidak ada key manual di game.

local function getOwnerIdentity()
	local creatorType = game.CreatorType == Enum.CreatorType.Group and "Group" or "User"
	return tostring(game.CreatorId), creatorType
end

function LicenseClient.Verify()
	local ownerId, ownerType = getOwnerIdentity()
	local payload = {
		ownerId = ownerId,
		ownerType = ownerType,
		product = PRODUCT,
		placeId = tostring(game.PlaceId),
		universeId = tostring(game.GameId),
		placeName = game.Name,
		gameName = game.Name,
		jobId = game.JobId,
		playerCount = #game:GetService("Players"):GetPlayers(),
		maxPlayers = game.Players.MaxPlayers,
		isPrivateServer = game.PrivateServerId ~= "",
		isStudio = game:GetService("RunService"):IsStudio(),
		systemVersion = SYSTEM_VERSION,
	}

	local success, response = pcall(function()
		return HttpService:RequestAsync({
			Url = VERIFY_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
			},
			Body = HttpService:JSONEncode(payload),
		})
	end)

	if not success then
		return false, "License API tidak dapat dihubungi"
	end

	local decodedSuccess, data = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not decodedSuccess or type(data) ~= "table" then
		return false, "Respons license API tidak valid"
	end

	if not response.Success or data.valid ~= true then
		return false, data.message or "Lisensi ditolak"
	end

	return true, data
end

return LicenseClient
