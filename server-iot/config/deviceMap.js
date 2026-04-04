// Mapping giữa device_code (tiếng Anh, dùng trong MQTT/API) và tên trong DB (tiếng Việt)
const CODE_TO_NAME = {
    pump:   'Van Tưới',
    heater: 'Máy Sưởi',
    mist:   'Phun Sương',
};

const NAME_TO_CODE = Object.fromEntries(
    Object.entries(CODE_TO_NAME).map(([code, name]) => [name, code])
);

module.exports = { CODE_TO_NAME, NAME_TO_CODE };
