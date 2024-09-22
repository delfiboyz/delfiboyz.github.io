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
    $parentName = $_POST['parentName'];
    $age = $_POST['age'];
    $trialDate = $_POST['trialDate'];
    $trialTime = $_POST['trialTime'];
    $phone = $_POST['phone'];
    $email = $_POST['email'];

    // Debug: Cek apakah semua data terisi
    if (empty($name) || empty($parentName) || empty($age) || empty($trialDate) || empty($trialTime) || empty($phone) || empty($email)) {
        error_log("Error: Ada field yang kosong.");
        echo json_encode(["status" => "error", "message" => "Error: Ada field yang kosong."]);
        exit();
    }

    // Gunakan prepared statement untuk menghindari SQL injection
    $stmt = $conn->prepare("INSERT INTO trial_registrations (child_name, child_age, parent_name, trial_date, trial_time, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?)");
    if (!$stmt) {
        error_log("Error: " . $conn->error);
        echo json_encode(["status" => "error", "message" => "Error: " . $conn->error]);
        exit();
    }
    $stmt->bind_param("sisssss", $name, $age, $parentName, $trialDate, $trialTime, $phone, $email);

    if ($stmt->execute()) {
        echo json_encode(["status" => "success", "message" => "Pendaftaran berhasil!"]);
        error_log("Pendaftaran berhasil untuk: " . $name);
    } else {
        echo json_encode(["status" => "error", "message" => "Error: " . $stmt->error]);
        error_log("Error: " . $stmt->error);
    }

    $stmt->close();
    $conn->close();
}
?>
