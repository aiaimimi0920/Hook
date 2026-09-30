extends SceneTree
## Isolated source-input oracle. Never loads a user's Godot project.

var clicks := 0
var downs := 0
var ups := 0
var output := OS.get_environment("HOOK_LIVE_GODOT_OUTPUT")
var button := Button.new()


func _initialize() -> void:
	root.title = "Hook Live Input Godot Fixture"
	root.size = Vector2i(420, 220)
	root.position = Vector2i(-10000, -10000)
	button.text = "Apply action"
	button.position = Vector2(40, 40)
	button.size = Vector2(160, 60)
	button.pressed.connect(_on_pressed)
	button.button_down.connect(_on_down)
	button.button_up.connect(_on_up)
	root.add_child(button)
	call_deferred("_publish_ready")


func _publish_ready() -> void:
	var center := button.position + button.size / 2.0
	var hwnd := DisplayServer.window_get_native_handle(DisplayServer.WINDOW_HANDLE)
	_write(
		"ready.json",
		{
			"pid": OS.get_process_id(),
			"windowId": "%x" % hwnd,
			"normalizedX": center.x / (root.size.x - 1.0),
			"normalizedY": center.y / (root.size.y - 1.0),
		}
	)
	_publish_state()


func _on_pressed() -> void:
	clicks += 1
	_publish_state()


func _on_down() -> void:
	downs += 1
	_publish_state()


func _on_up() -> void:
	ups += 1
	_publish_state()


func _publish_state() -> void:
	_write("state.json", {"clicks": clicks, "downs": downs, "ups": ups})


func _write(name: String, value: Dictionary) -> void:
	var file := FileAccess.open(output.path_join(name), FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify(value))
