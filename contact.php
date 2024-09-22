<?php
// Koneksi ke database
$servername = "localhost";
$username = "u164192416_kreafdemy";
$password = "Yeotan89";
$dbname = "u164192416_kreafdemy";

$conn = new mysqli($servername, $username, $password, $dbname);

if ($conn->connect_error) {
    echo json_encode(["status" => "error", "message" => "Connection failed: " . $conn->connect_error]);
    exit();
}

// Proses penyimpanan data form
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Debug: Cek data yang diterima
    error_log("Data yang diterima dari form: " . print_r($_POST, true));

    // Ambil data dari form
    $name = $_POST['name'];
    $email = $_POST['email'];
    $phone = $_POST['phone'];
    $reason = $_POST['reason'];
    $message = $_POST['message'];

    // Debug: Cek apakah semua data terisi
    if (empty($name) || empty($email) || empty($phone) || empty($reason) || empty($message)) {
        error_log("Error: Ada field yang kosong.");
        echo json_encode(["status" => "error", "message" => "Error: Ada field yang kosong."]);
        exit();
    }

    // Gunakan prepared statement untuk menghindari SQL injection
    $stmt = $conn->prepare("INSERT INTO contact_messages (name, email, phone, reason, message) VALUES (?, ?, ?, ?, ?)");
    if (!$stmt) {
        error_log("Error: " . $conn->error);
        echo json_encode(["status" => "error", "message" => "Error: " . $conn->error]);
        exit();
    }
    $stmt->bind_param("sssss", $name, $email, $phone, $reason, $message);

    if ($stmt->execute()) {
        echo json_encode(["status" => "success", "message" => "Pesan berhasil dikirim!"]);
        error_log("Pesan berhasil dikirim dari: " . $name);
    } else {
        echo json_encode(["status" => "error", "message" => "Error: " . $stmt->error]);
        error_log("Error: " . $stmt->error);
    }

    $stmt->close();
    $conn->close();
}
?>
